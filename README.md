# Yo9GAG
[![Stack Share](http://img.shields.io/badge/tech-stack-0690fa.svg?style=flat)](http://stackshare.io/Anubisss/yo9gag)

[Yo9GAG](https://anubisss.github.io/yo9gag) is a [Yo](http://justyo.co/) app written in [Node.js](https://nodejs.org/) and using [Redis](http://redis.io/) as a DB backend.

[Just Yo](http://justyo.co/) is the simplest and most efficient (zero) communication tool in the world.

## What it does
* When you Yo the app it will Yo back to you with a random [9GAG](http://9gag.com) link from the [hot](http://9gag.com/hot) top 100.
* If you subscribed to the app (if you ever Yo'd to it) it will Yo you (with the link) when a 9GAG post reaches at least 40k votes.

## Get it started
If you want to use the application with your Yo account, just Yo **YONINEGAG** and that will make you a subscriber.
* Homepage: https://anubisss.github.io/yo9gag
* Repo: https://github.com/Anubisss/yo9gag

## How it works
The application is basically a Node.js [express](http://expressjs.com/) webserver ([server.js](https://github.com/Anubisss/yo9gag/blob/master/server.js)) which runs on a free [Heroku](https://www.heroku.com/) dyno. When somebody Yo the app receives a callback (webhook) and Yo a random link from a redis list. This list stores the current top 100 hot 9GAG links. There is script ([uploader.js](https://github.com/Anubisss/yo9gag/blob/master/uploader.js)) which runs at every X minutes by the [Heroku Scheduler](https://addons.heroku.com/scheduler) and uploads the current top 100 hot 9GAG links to redis using the [InfiniGAG](https://github.com/k3min/infinigag) API. Also this script detects that a 9GAG post has at least 40k votes and if yes it Yo all to the subscribers. The app uses the [YoJS](https://www.npmjs.com/package/yojs) to communicate with the [Yo API](http://docs.justyo.co/v1.0/docs/getting-started).

## License
The MIT License (MIT)
