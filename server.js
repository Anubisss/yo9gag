'use strict';

// this should be the first line of the app
if (process.env.NEW_RELIC_LICENSE_KEY) {
  require('newrelic');
}

var express = require('express');
var async = require('async');
var redis = require('redis');
var redisUrl = require('redis-url');
var YoJS = require('yojs');

// the port where the app (express webserver) listens
var APP_PORT = process.env.PORT || 3000;

// this env var for redis Redis Labs, https://redislabs.com/
var REDISCLOUD_URL = process.env.REDISCLOUD_URL;
// redis server URI
var REDIS_SERVER_URI = REDISCLOUD_URL;
// how many times should the redis client try to connect if the redis server is unavailable
var REDIS_CONNECT_MAX_ATTEMPTS = process.env.REDIS_CONNECT_MAX_ATTEMPTS || 5;

// redis key, this stores the top 100 9GAG links
var REDIS_KEY_TOP9GAGS = process.env.REDIS_KEY_TOP9GAGS || 'top9gags';
// redis key, this stores the yo9gag subscribers
var REDIS_KEY_SUBSCRIBERS = process.env.REDIS_KEY_SUBSCRIBERS || 'yo9gag_subscribers';
// redis key, this stores statistics about received Yos by date
var REDIS_KEY_STATISTICS_YO_COUNT = process.env.REDIS_KEY_STATISTICS_YO_COUNT || 'statistics:yo';
// redis key, this stores new subscribers by date
var REDIS_KEY_STATISTICS_NEW_SUBSCRIBER_COUNT = process.env.REDIS_KEY_STATISTICS_NEW_SUBSCRIBER_COUNT || 'statistics:new_subscribers';

// URL of the Yo API
var YO_API_URL = process.env.YO_API_URL || 'https://api.justyo.co/';
// Yo API access token/key
var YO_API_TOKEN = process.env.YO_API_TOKEN || process.argv[3];
// length of a valid Yo API key/token
var YO_API_TOKEN_LENGTH = 36;

// how many 9GAG links should the redis store in REDIS_KEY_TOP9GAGS
// so when somebody Yo, yo9gag will send a random 9GAG to him/her from this list
var TOP9GAGS_COUNT = process.env.TOP9GAGS_COUNT || 100;

// global redis client
var redisClient = null;

// starts the app! :)
start();

// basically this starts the app
// connects to the redis server then
// starts the express webserver which will wait for receiving Yo callbacks
function start() {
  console.log('start, APP_PORT: %s', APP_PORT);

  // invalid Yo API key/token
  if (!YO_API_TOKEN || typeof YO_API_TOKEN !== 'string' || YO_API_TOKEN.length !== YO_API_TOKEN_LENGTH) {
    console.error('start error, the Yo API token is invalid, YO_API_TOKEN: %s', YO_API_TOKEN);
    // just quits
    process.exit(1);
  }

  // stores the parsed redis URI
  var parsedRedisUri = null;
  try {
    // tries to parse the given redis server URI
    parsedRedisUri = redisUrl.parse(REDIS_SERVER_URI);
  }
  // invalid redis URI
  catch (ex) {
    console.error('start error, redis URI can\'t be parsed, ex: %s', ex);
    process.exit(1);
  }

  console.log('start, redis server: redis://:*****@%s:%s, REDIS_CONNECT_MAX_ATTEMPTS: %s',
              parsedRedisUri.hostname,
              parsedRedisUri.port,
              REDIS_CONNECT_MAX_ATTEMPTS);

  // some options for the redis client
  var redisClientOptions = {
    auth_pass: parsedRedisUri.password,
    max_attempts: REDIS_CONNECT_MAX_ATTEMPTS,
    enable_offline_queue: false
  };

  try {
    // tries to connect to the redis server
    redisClient = redis.createClient(parsedRedisUri.port, parsedRedisUri.hostname, redisClientOptions);
  }
  // something bad happened here
  catch (ex) {
    console.error('start error, redisClient can\'t be created, ex: %s', ex);
    process.exit(1);
  }

  // connected to the redis server
  redisClient.on('ready', function() {
    console.log('start, connected to redis');

    // creates the express webserver app
    var app = express();
    // creates a router
    var appRouter = express.Router();

    // this URL will be called by a Yo webhook
    appRouter.get('/yo/', handleYo);
    app.use('/', appRouter);

    // starts the express webserver
    app.listen(APP_PORT, function() {
      console.log('start, webserver is listening on port: %s', APP_PORT);
    });
  });
  // redis error
  redisClient.on('error', function(err) {
    console.error('start error, redisClient error: %s', err);
  });
}

// handles the Yo webhook
// this methods called when the Yo account receives a Yo
function handleYo(req, res) {
  var yoUsername = req.query.username;
  var yoUserIp = req.query.user_ip;
  console.log('handleYo, yoUsername: %s, yoUserIp: %s', yoUsername, yoUserIp);

  // no Yo username
  if (!yoUsername) {
    res.sendStatus(400).end(); // 400 - Bad Request
    console.error('handleYo error, no Yo username in the Yo callback');
  } else {
    yoUsername = yoUsername.toUpperCase();
    // everything should be fine
    res.sendStatus(200).end(); // 200 - OK
    // Yos him/her
    yoRandom9gagLink(yoUsername);
    // saves the subscriber if it's new
    saveYoSubscriber(yoUsername);
    // updates the statistics about the number of received Yos
    updateStatistics(REDIS_KEY_STATISTICS_YO_COUNT);
  }
}

// Yos a random 9GAG link to yoUsername
function yoRandom9gagLink(yoUsername)
{
  console.log('yoRandom9gagLink, yoUsername: %s', yoUsername);

  async.waterfall([
    // just in case counts how many values (9GAG links) in the list
    function(callback) {
      redisClient.scard(REDIS_KEY_TOP9GAGS, function(err, res) {
        setImmediate(callback, err, res);
      });
    },
    // then gets a random value (9GAG link) from the list
    function(scardRes, callback) {
      // error message if REDIS_KEY_TOP9GAGS redis key has more or less values than TOP9GAGS_COUNT
      if (scardRes != TOP9GAGS_COUNT) {
        console.error('yoRandom9gagLink, Redis SCARD error, result: %s instead of: %s', scardRes, TOP9GAGS_COUNT);
      }
      redisClient.srandmember(REDIS_KEY_TOP9GAGS, function(err, res) {
        setImmediate(callback, err, res);
      });
    },
    // finally Yos the random 9GAG link
    function(srandmemberRes, callback) {
      // no 9GAG link
      if (!srandmemberRes) {
        setImmediate(callback, new Error('invalid srandmemberRes: ' + srandmemberRes));
      } else {
        console.log('yoRandom9gagLink, srandmemberRes: %s', srandmemberRes);
        // Yos the link to yoUsername, then process the response
        YoJS.yo(YO_API_URL, YO_API_TOKEN, yoUsername, srandmemberRes, '', function(err, res, body) {
          if (!err) {
            // non 200 response
            if (res.statusCode !== 200) {
              setImmediate(callback, new Error('Got res.statusCode ' + res.statusCode + ' instead of 200, body: ' + body));
            } else {
              // parses the response
              var parsedBody = JSON.parse(body);
              // error
              if (!parsedBody || parsedBody.success !== true) {
                setImmediate(callback, new Error('Invalid/empty success in the response, body: ' + body));
              } else {
                // everything fine
                setImmediate(callback);
              }
            }
          // error occurred
          } else {
            setImmediate(callback, err);
          }
        });
      }
    }
  ],
  // final callback
  function(err) {
    if (err) {
      console.error('yoRandom9gagLink error, err: %s', err);
    }
  });
}

// saves the subscriber (who Yo'd)
function saveYoSubscriber(yoUsername) {
  console.log('saveYoSubscriber, yoUsername: %s', yoUsername);
  redisClient.sadd(REDIS_KEY_SUBSCRIBERS, yoUsername, function(err, res) {
    if (err) {
      console.error('saveYoSubscriber error, SADD err: %s', err);
    }
    // new subscriber
    else if (res === 1) {
      console.log('saveYoSubscriber, new subscriber: %s', yoUsername);
      updateStatistics(REDIS_KEY_STATISTICS_NEW_SUBSCRIBER_COUNT);
    }
    // just in case...
    else if (res !== 0) {
      // something wrong happened here
      console.error('saveYoSubscriber error, Redis SADD result: %s, instead of 0 or 1', res);
    }
  });
}

// updates some statistics
// redisKey: - REDIS_KEY_STATISTICS_NEW_SUBSCRIBER_COUNT, how many new subscribers on a day
//           - REDIS_KEY_STATISTICS_YO_COUNT, how many Yo received on a day
function updateStatistics(redisKey) {
  var now = new Date();

  // year
  var nowYear = now.getFullYear();
  // month
  var nowMonth = now.getMonth() + 1;
  // day
  var nowDay = now.getDate();

  // leading zeros
  if (nowMonth < 10)
    nowMonth = '0' + nowMonth;
  if (nowDay < 10)
    nowDay = '0' + nowDay;

  // date in nice format
  var statisticsDate = nowDay + '-' + nowMonth + '-' + nowYear;

  console.log('updateStatistics, redisKey: %s, statisticsDate: %s', redisKey, statisticsDate);

  // increments a counter by one
  redisClient.hincrby(redisKey, statisticsDate, 1, function(err) {
    if (err) {
      console.error('updateStatistics error, Redis HINCRBY error: %s', err);
    }
  });
}
