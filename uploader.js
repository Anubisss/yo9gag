'use strict';

var async = require('async');
var request = require('request');
var redis = require('redis');
var redisUrl = require('redis-url');
var YoJS = require('yojs');

// this env var for redis Redis Labs, https://redislabs.com/
var REDISCLOUD_URL = process.env.REDISCLOUD_URL;
// redis server URI
var REDIS_SERVER_URI = REDISCLOUD_URL;
// how many times should the redis client try to connect if the redis server is unavailable
var REDIS_CONNECT_MAX_ATTEMPTS = process.env.REDIS_CONNECT_MAX_ATTEMPTS || 5;

// redis key, this stores the top 100 9GAG links
var REDIS_KEY_TOP9GAGS = process.env.REDIS_KEY_TOP9GAGS || 'top9gags';
// redis key, this stores the best (at least BEST9GAGS_VOTES_COUNT upvotes) 9GAG links
var REDIS_KEY_BEST9GAGS = process.env.REDIS_KEY_BEST9GAGS || 'best9gags';

// InfiniGAG is an unofficial 9GAG REST API, this variable stores the access URL for it
var INFINIGAG_API_URL = process.env.INFINIGAG_API_URL || 'http://infinigag.k3min.eu/';
// how many 9GAG links should the redis store in REDIS_KEY_TOP9GAGS
var TOP9GAGS_COUNT = process.env.TOP9GAGS_COUNT || 100;
// how many votes need a 9GAG link to become a "best 9GAG"
// best 9GAG links will be Yo'd to all subscribers
var BEST9GAGS_VOTES_COUNT = process.env.BEST9GAGS_VOTES_COUNT || 40000;

// URL of the Yo API
var YO_API_URL = process.env.YO_API_URL || 'https://api.justyo.co/';
// Yo API access token/key
var YO_API_TOKEN = process.env.YO_API_TOKEN || process.argv[3];
// length of a valid Yo API key/token
var YO_API_TOKEN_LENGTH = 36;

// starts the uploader
start();

function start() {
  console.log('uploader starts');

  // stores the parsed redis URI
  var parsedRedisUrl = null;
  try {
    // tries to parse the given redis server URI
    parsedRedisUrl = redisUrl.parse(REDIS_SERVER_URI);
  }
  catch (ex) {
    console.error('start error, redis URI can\'t be parsed, ex: %s', ex);
    // just quits
    process.exit(1);
  }

  console.log('start, redis server: redis://:*****@%s:%s, REDIS_CONNECT_MAX_ATTEMPTS: %s, REDIS_KEY_TOP9GAGS: %s',
              parsedRedisUrl.hostname,
              parsedRedisUrl.port,
              REDIS_CONNECT_MAX_ATTEMPTS,
              REDIS_KEY_TOP9GAGS);
  console.log('start, INFINIGAG_API_URL: %s, TOP9GAGS_COUNT: %s, BEST9GAGS_VOTES_COUNT: %s', INFINIGAG_API_URL, TOP9GAGS_COUNT, BEST9GAGS_VOTES_COUNT);

  // options for the redis client
  var redisClientOptions = {
    auth_pass: parsedRedisUrl.password,
    max_attempts: REDIS_CONNECT_MAX_ATTEMPTS,
    enable_offline_queue: false
  };

  var redisClient = null;
  try {
    // tries to connect to the redis server
    redisClient = redis.createClient(parsedRedisUrl.port, parsedRedisUrl.hostname, redisClientOptions);
  }
  catch (ex) {
    console.error('start error, redisClient can\'t be created, ex: %s', ex);
    process.exit(1);
  }

  // connected to the redis server
  redisClient.on('ready', function() {
    console.log('start, connected to redis');
    // this does the real job
    saveTopHot9gagLinks(redisClient);
  });
  // redis error
  redisClient.on('error', function(err) {
    console.error('start error, redisClient error: %s', err);
  });
}

// saves the TOP9GAGS_COUNT top hot links from 9GAG
function saveTopHot9gagLinks(redisClient)
{
  console.log('saveTopHot9gagLinks');
  async.waterfall([
    // gets the top hot 9GAG links from the API
    function(callback) {
      getTopHot9gagsFromApi(redisClient, function(err, res) {
        setImmediate(callback, err, res);
      });
    },
    // then saves the links to redis
    function(top9gagLinks, callback) {
      // error message if gets more or less links than the value in TOP9GAGS_COUNT
      if (top9gagLinks.length != TOP9GAGS_COUNT) {
        console.error('saveTopHot9gagLinks error, got %s links instead of %s', top9gagLinks.length, TOP9GAGS_COUNT);
      }
      insertTopHot9gagLinkToRedis(redisClient, top9gagLinks, function(err) {
        setImmediate(callback, err);
      });
    }
  ],
  // final callbacak
  function(err, res) {
    if (err) {
      console.error('saveTopHot9gagLinks error: %s', err);
    }
    // disconnect from redis
    redisClient.quit();
    console.log('uploader done');
  });
}

// get TOP9GAGS_COUNT links from the top of the hot section at 9GAG
function getTopHot9gagsFromApi(redisClient, callback) {
  console.log('getTopHot9gagsFromApi');

  // stores the links
  var hot9gagLinks = [];
  // paginating
  var pageId = '0';

  // does the job
  async.whilst(
    // until this is true
    function() {
      return hot9gagLinks.length < TOP9GAGS_COUNT;
    },
    // job
    function(callback) {
      // will request this API URL
      var requestUrl = INFINIGAG_API_URL + 'hot/' + pageId;
      console.log('getTopHot9gagsFromApi requestUrl: %s', requestUrl);

      // makes a request to the API
      request.get(requestUrl, function(err, res, body) {
        if (err) {
          setImmediate(callback, err);
        } else {
          // non 200 HTTP status code
          if (res.statusCode !== 200) {
            setImmediate(callback, new Error('Got ' + res.statusCode + ' res.statusCode instead of 200'));
            return;
          }

          // parses the response's body
          var hot9gagEntries = JSON.parse(body);

          // makes some error checks
          if (!hot9gagEntries || !hot9gagEntries.data || !Array.isArray(hot9gagEntries.data) || hot9gagEntries.data.length < 1) {
            var errorMessage = 'invalid hot9gagEntries from the API,';
            errorMessage += ' hot9gagEntries: ' + hot9gagEntries;
            if (hot9gagEntries) {
              errorMessage += ', hot9gagEntries.data: ' + hot9gagEntries.data;
              if (Array.isArray(hot9gagEntries.data)) {
                errorMessage += ', hot9gagEntries.data.length: ' + hot9gagEntries.data.length;
              }
            }
            setImmediate(callback, new Error(errorMessage));
            return;
          }

          // iterates over the data from the API (just 1 page)
          async.eachSeries(hot9gagEntries.data, function(hot9gagEntry, callback) {
            // done
            if (hot9gagLinks.length >= TOP9GAGS_COUNT) {
              setImmediate(callback);
              return;
            }
            // no link in the 9GAG entry from the API
            if (!hot9gagEntry.link) {
              console.error('getTopHot9gagsFromApi error, no link');
              setImmediate(callback);
              return;
            }

            // saves the link to the array
            hot9gagLinks.push(hot9gagEntry.link);
            console.log('getTopHot9gagsFromApi hot9gagLinks.length: %s. 9gag link: %s', hot9gagLinks.length, hot9gagEntry.link);

            // no votes in the entry
            if (!hot9gagEntry.votes || !hot9gagEntry.votes.count) {
              console.error('getTopHot9gagsFromApi error, no votes.count');
              setImmediate(callback);
              return;
            }

            // if this entry is a best 9GAG
            if (hot9gagEntry.votes.count > BEST9GAGS_VOTES_COUNT) {
              // saves to redis list of best 9GAG links
              redisClient.sadd(REDIS_KEY_BEST9GAGS, hot9gagEntry.link, function(err, res) {
                if (err) {
                  console.error('getTopHot9gagsFromApi error, Redis SADD err: %s', err);
                } else {
                  // this entry is a new best 9GAG, let's Yo to all subscribers
                  if (res === 1) {
                    console.log('getTopHot9gagsFromApi found a BEST9GAG: %s', hot9gagEntry.link);
                    setTimeout(YoJS.yoAll, 1000, YO_API_URL, YO_API_TOKEN, hot9gagEntry.link, function(err, res, body) {
                      if (err) {
                        console.error('getTopHot9gagsFromApi error, yoAll err: %s', err);
                      }
                      else if (res.statusCode !== 200) {
                        console.error('getTopHot9gagsFromApi error, yoAll statusCode is %s instead of 200, body: %s', res.statusCode, body);
                      }
                    });
                  }
                  // just in case again :)
                  else if (res !== 0) {
                    console.error('getTopHot9gagsFromApi error, Redis SADD result: %s instead of 0 or 1', res);
                  }
                }
                setImmediate(callback);
              });
            } else {
              setImmediate(callback);
            }
          },
          // eachSeries' final callback
          function(err) {
            // iteration on the data array is done, so need a new page
            pageId = !hot9gagEntries.paging || !hot9gagEntries.paging.next ? '' : hot9gagEntries.paging.next;
            if (!pageId) {
              setImmediate(callback, new Error('no pageId'));
            } else {
              console.log('getTopHot9gagsFromApi pageId: %s', pageId);
              setImmediate(callback);
            }
          });
        }
      });
    },
    // whilst's final callback
    function(err) {
      if (!err) {
        if (hot9gagLinks.length != TOP9GAGS_COUNT) {
          console.error('getTopHot9gagsFromApi error, got %s links instead of %s', hot9gagLinks.length, TOP9GAGS_COUNT);
        }
      }
      setImmediate(callback, err, hot9gagLinks);
    });
}

// saves the 9GAG links to a redis list
function insertTopHot9gagLinkToRedis(redisClient, top9gagLinks, callback) {
  var top9gagsLength = top9gagLinks.length;
  console.log('insertTopHot9gagLinkToRedis top9gagLinks.length: %s', top9gagsLength);

  // TODO: transaction
  async.series([
    // deletes the old list
    function(callback) {
      redisClient.del(REDIS_KEY_TOP9GAGS, function(err, res) {
        setImmediate(callback, err, res);
      });
    },
    // then makes the new list
    function(callback) {
      redisClient.sadd(REDIS_KEY_TOP9GAGS, top9gagLinks, function(err, res) {
        setImmediate(callback, err, res);
      });
    },
    // then counts how many members (links) in the list
    function(callback) {
      redisClient.scard(REDIS_KEY_TOP9GAGS, function(err, res) {
        setImmediate(callback, err, res);
      });
    }
  ],
  // final callback
  function(err, res) {
    if (err) {
      console.error('insertTopHot9gagLinkToRedis error: %s', err);
    } else {
      var keyDelRes = res[0];
      var keySaddRes = res[1];
      var keysScardRes = res[2];
      console.log('insertTopHot9gagLinkToRedis keyDelRes: %s, keySaddRes: %s, keysScardRes: %s', keyDelRes, keySaddRes, keysScardRes);

      if (keyDelRes !== 1) {
        console.error('insertTopHot9gagLinkToRedis error, Redis DEL result: %s intead of: %s', keyDelRes, 1);
      }
      if (keySaddRes !== top9gagsLength) {
        console.error('insertTopHot9gagLinkToRedis error, Redis SADD result: %s intead of: %s', keySaddRes, top9gagsLength);
      }
      if (keysScardRes !== top9gagsLength) {
        console.error('insertTopHot9gagLinkToRedis error, Redis SCARD result: %s intead of: %s', keysScardRes, top9gagsLength);
      }
    }
    console.log('insertTopHot9gagLinkToRedis done');
    setImmediate(callback, err);
  });
}
