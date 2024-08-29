# setup environment 
```
TELEGRAM_BOT_TOKEN=bot_token
REDIS_URL=redis://localhost:6379
PORT=3005
```

# Install
```yarn```
# Run Locally 
```yarn test```
# Functionality 

Telegram users can set alerts on any crypto asset with a target above or below current price. When an alert is triggered, the message will be delivered continously until the alert is deleted

- open telegram app, message bot with commands 
- ```/list```
- ```/above <symbol> <price>``` : setup alerts
- ```/below <symbol> <price>``` : setup alerts
- ```/delete_<symbol> ``` : delete alerts with action button
- ```/reset <symbol> ``` : deletes both alerts

# vercel 
- ```yarn add @vercel/kv```
- ```yarn global add vercel@latest```

Ouch 
- Can't do polling with TG bot
- Can't use websockets (serverless, stateless), 
- can only do a cron job probably: not tested yet