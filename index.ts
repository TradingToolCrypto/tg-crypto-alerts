// @ts-nocheck
/*
run
npx ts-node robots/telegram/useralerts.ts

else need to add 
requires package.json 
 "type": "module" ,

 and change all import to require


*/
import express, { Request, Response } from 'express';
import TelegramBot from 'node-telegram-bot-api';
import WebSocket from 'ws';
import { createClient } from 'redis';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const app = express();
//app.use(express.json());

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN as string, {
    polling: true,
    filepath: false,
});

// Initialize Redis client
const redisClient = createClient({
    url: process.env.REDIS_URL
});

// Connect to Redis
const connectRedis = async () => {
    try {
        await redisClient.connect();
        console.error('Connected to Redis');
    } catch (error) {
        console.error('Failed to connect to Redis:', error);
    }
};

connectRedis();

// Connect to Redis
redisClient.on('error', (err) => {
    console.error('Redis Connect error:', err);
});

// Function to send a message to a user
const sendAlert = async (userId: number, message: string, sym: string, pr: number, id: number): Promise<void> => {
    try {
        await bot.sendMessage(userId, message + "\n" + `/delete_${sym}`);
        console.error(`Alert sent to userID: ${userId}: (message) ${message}`);
    } catch (error) {
        console.error(`Failed to send message to user ${userId}:`, error);
    }
};

// Function to handle new price updates
const handlePriceUpdate = async (symbol: string, price: number): Promise<void> => {
    try {
        // Ensure Redis client is connected
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }

        const USERS_UP = await redisClient.hGetAll('alert_above');
        for (const [userId, alerts] of Object.entries(USERS_UP)) {
            const userAlerts = JSON.parse(alerts);
            const alertPrice = userAlerts[symbol];
            if (alertPrice <= price) {
                await sendAlert(Number(userId), `${symbol}\nPrice Above $${price}`, symbol, alertPrice);
            }
        }


        const USERS_DN = await redisClient.hGetAll('alert_below');
        for (const [userId, alerts] of Object.entries(USERS_DN)) {
            const userAlerts = JSON.parse(alerts);
            const alertPrice = userAlerts[symbol];
            if (alertPrice >= price) {
                await sendAlert(Number(userId), `${symbol}\nPrice Below $${price}`, symbol, alertPrice);
            }
        }

    } catch (error) {
        console.error('Error handling price update:', error);
    }
};

// Connect to Binance WebSocket API
const binanceWsUrl = 'wss://stream.binance.com:9443/ws/!miniTicker@arr';
const ws = new WebSocket(binanceWsUrl);

ws.on('open', () => {
    console.error('Connected to Binance WebSocket API');
});

ws.on('message', async (data: WebSocket.MessageEvent) => {
    const message = data.toString();
    try {
        const tickers = JSON.parse(message) as Array<{ s: string; c: string }>;
        for (const ticker of tickers) {
            const { s: symbol, c: price } = ticker;
            //  console.error(" SYMBOL EXIST CHECK ", symbol);
            //  console.error(`SYMBOL EXIST CHECK ${symbol} ${price} `);
            await handlePriceUpdate(symbol, parseFloat(price));
        }
    } catch (error) {
        console.error('Error parsing message from WebSocket:', error);
    }
});

ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});

ws.on('close', () => {
    console.error('WebSocket connection closed');
});

// Start Express server
const port = process.env.PORT || 3002;
app.listen(port, async () => {
    // Handle incoming messages
    // bot.onText(/\/alert (.+) (.+)/, async (msg, match) => {
    //     const chatId = msg.chat.id;
    //     const symbol = match[1].toUpperCase();
    //     const price = parseFloat(match[2]);

    //     try {
    //         const alerts = await redisClient.hGet('alerts', chatId.toString());
    //         const userAlerts = alerts ? JSON.parse(alerts) : {};
    //         userAlerts[symbol] = price;
    //         await redisClient.hSet('alerts', chatId.toString(), JSON.stringify(userAlerts));
    //         await bot.sendMessage(chatId, `Alert set for ${symbol} at $${price}`);
    //     } catch (error) {
    //         console.error('Error setting alert:', error);
    //         await bot.sendMessage(chatId, 'Failed to set alert. Please try again later.');
    //     }
    // });

    // Handle incoming messages
    bot.onText(/\/above (.+) (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const symbol = match[1].toUpperCase();
        const price = parseFloat(match[2]);

        const ts = new Date();

        try {
            const alerts = await redisClient.hGet('alert_above', chatId.toString());

            console.error('t1 ', alerts);


            const userAlerts = alerts ? JSON.parse(alerts) : {};

            console.error('t2 ', userAlerts);


            userAlerts[symbol] = price;

            console.error('t3 ', userAlerts.length);

            await redisClient.hSet('alert_above', chatId.toString(), JSON.stringify(userAlerts));
            await bot.sendMessage(chatId, `Alert set for ${symbol} at $${price}`);
        } catch (error) {
            console.error('Error setting alert:', error);
            await bot.sendMessage(chatId, 'Failed to set alert. Please try again later.');
        }
    });

    // Handle incoming messages
    bot.onText(/\/below (.+) (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const symbol = match[1].toUpperCase();
        const price = parseFloat(match[2]);
        try {
            const alerts = await redisClient.hGet('alert_below', chatId.toString());
            const userAlerts = alerts ? JSON.parse(alerts) : {};
            userAlerts[symbol] = price;
            await redisClient.hSet('alert_below', chatId.toString(), JSON.stringify(userAlerts));
            await bot.sendMessage(chatId, `Alert set for ${symbol} at $${price}`);
        } catch (error) {
            console.error('Error setting alert:', error);
            await bot.sendMessage(chatId, 'Failed to set alert. Please try again later.');
        }
    });


    // REMOVE ALL THE ALERTS FOR THIS SYMBOL 
    // todo : need to fix this be searching for the above and below alert data
    bot.onText(/\/remove (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const symbol = match[1].toUpperCase();

        try {

            const alerts = await redisClient.hGet('alerts', chatId.toString());// above and below alert data

            const userAlerts = alerts ? JSON.parse(alerts) : {};
            delete userAlerts[symbol];
            await redisClient.hSet('alerts', chatId.toString(), JSON.stringify(userAlerts));
            await bot.sendMessage(chatId, `Alert removed for ${symbol}`);
        } catch (error) {
            console.error('Error removing alert:', error);
            await bot.sendMessage(chatId, 'Failed to remove alert. Please try again later.');
        }
    });

    // todo , deletes all the alerts for that symbol : needs to delete only the alert triggered. 
    bot.onText(/\/delete_(.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const symbol = match[1].toUpperCase();

        console.error("DELETE ALERT ", symbol);

        // try {
        //     const alerts = await redisClient.hGet('alerts', chatId.toString());
        //     const userAlerts = alerts ? JSON.parse(alerts) : {};
        //     delete userAlerts[symbol];
        //     await redisClient.hSet('alerts', chatId.toString(), JSON.stringify(userAlerts));
        //     await bot.sendMessage(chatId, `Alert deleted for ${symbol}`);
        // } catch (error) {
        //     console.error('Error removing alert:', error);
        //     await bot.sendMessage(chatId, 'Failed to remove alert. Please try again later.');
        // }
        try {
            const alerts = await redisClient.hGet('alert_above', chatId.toString());
            const userAlerts = alerts ? JSON.parse(alerts) : {};
            delete userAlerts[symbol];
            await redisClient.hSet('alert_above', chatId.toString(), JSON.stringify(userAlerts));
            await bot.sendMessage(chatId, `Alert deleted for ${symbol}`);
        } catch (error) {
            console.error('Error removing alert:', error);
            await bot.sendMessage(chatId, 'Failed to remove alert. Please try again later.');
        }
        try {
            const alerts = await redisClient.hGet('alert_below', chatId.toString());
            const userAlerts = alerts ? JSON.parse(alerts) : {};
            delete userAlerts[symbol];
            await redisClient.hSet('alert_below', chatId.toString(), JSON.stringify(userAlerts));
            await bot.sendMessage(chatId, `Alert deleted for ${symbol}`);
        } catch (error) {
            console.error('Error removing alert:', error);
            await bot.sendMessage(chatId, 'Failed to remove alert. Please try again later.');
        }
    });

    bot.onText(/\/list/, async (msg) => {
        const chatId = msg.chat.id;
        const chatUser = msg.chat.username;

        try {


            // const alerts = await redisClient.hGet('alerts', chatId.toString());
            // const userAlerts = alerts ? JSON.parse(alerts) : {};
            // if (Object.keys(userAlerts).length === 0) {
            //     await bot.sendMessage(chatId, 'You have no alerts set.');
            // } else {
            //     const alertsList = Object.entries(userAlerts)
            //         .map(([symbol, price]) => `${symbol}: $${price}`)
            //         .join('\n');
            //     await bot.sendMessage(chatId, `Your alerts @${chatUser} \n${alertsList}`);
            // }

            const alertA = await redisClient.hGet('alert_above', chatId.toString());
            const alertB = await redisClient.hGet('alert_below', chatId.toString());

            const userAlertA = alertA ? JSON.parse(alertA) : {};
            const userAlertB = alertB ? JSON.parse(alertB) : {};

            if (Object.keys(userAlertA).length === 0 && Object.keys(userAlertB).length === 0) {
                await bot.sendMessage(chatId, 'You have no alerts set.');
            } else {
                const alertsListA = Object.entries(userAlertA)
                    .map(([symbol, price]) => `${symbol}: $${price}`)
                    .join('\n');

                const alertsListB = Object.entries(userAlertB)
                    .map(([symbol, price]) => `${symbol}: $${price}`)
                    .join('\n');

                await bot.sendMessage(chatId, `Your alerts @${chatUser}\nAbove\n${alertsListA} \nBelow\n${alertsListB}`);
            }


        } catch (error) {
            console.error('Error listing alerts:', error);
            await bot.sendMessage(chatId, 'Failed to list alerts. Please try again later.');
        }
    });

});



// Graceful shutdown
const shutdown = async () => {

    //Close Redis
    try {
        await redisClient.quit();
        console.error('Redis client disconnected');
        await ws.close()
    } catch (error) {
        console.error('Error during Redis client shutdown:', error);
    }

    // Close WebSocket connection
    if (ws.readyState === WebSocket.OPEN) {
        ws.close();
        console.error('WebSocket connection closed');
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// npx ts-node robots/telegram/ws2.1.ts