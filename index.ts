
// @ts-nocheck
import { createClient } from '@vercel/kv';
import express, { Request, Response } from 'express';
import TelegramBot from 'node-telegram-bot-api';
import WebSocket from 'ws';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

console.log("Test Deployment", process.env);
console.warn("Test Deployment", process.env);
console.error("Test Deployment", process.env);

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN as string);

// Parse incoming requests as JSON
app.use(express.json());

// Setup the Telegram webhook route
app.post(`/bot${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Set the webhook URL
// bot.setWebHook(`${process.env.VERCEL_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`);
// Set up your webhook with Telegram
const setWebhook = async () => {
    const webhookUrl = `${process.env.VERCEL_URL}`; // Replace with your domain
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok) {
            console.log('Webhook set successfully');
        } else {
            console.error('Error setting webhook:', data.description);
        }
    } catch (err) {
        console.error('Failed to set webhook:', err);
    }
};

setWebhook(); // Set the webhook when the server starts



// Initialize Redis client
const redisClient = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});


let GLOBAL_SYMBOL_SAVED = 'btcusdt';

// Function to send an alert message to a user
const sendAlert = async (userId: number, message: string, symbol: string): Promise<void> => {
    try {
        await bot.sendMessage(userId, `${message}\n/delete_${symbol}`);
        console.log(`Alert sent to userID: ${userId}: ${message}`);
    } catch (error) {
        console.error(`Failed to send message to user ${userId}:`, error);
    }
};

// Function to handle new price updates
const handlePriceUpdate = async (symbol: string, price: number): Promise<void> => {
    try {

        const [alertsAbove, alertsBelow] = await Promise.all([
            redisClient.hGetAll('alert_above'),
            redisClient.hGetAll('alert_below'),
        ]);

        for (const [userId, alerts] of Object.entries(alertsAbove)) {
            const userAlerts = JSON.parse(alerts);
            const alertPrice = userAlerts[symbol];
            if (alertPrice <= price) {
                await sendAlert(Number(userId), `${symbol} - Price Above $${price}`, symbol);
            }
        }

        for (const [userId, alerts] of Object.entries(alertsBelow)) {
            const userAlerts = JSON.parse(alerts);
            const alertPrice = userAlerts[symbol];
            if (alertPrice >= price) {
                await sendAlert(Number(userId), `${symbol} - Price Below $${price}`, symbol);
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
    console.log('Connected to Binance WebSocket API');
});

ws.on('message', async (data) => {
    try {
        const tickers = JSON.parse(data.toString()) as Array<{ s: string; c: string }>;
        for (const { s: symbol, c: price } of tickers) {
            await handlePriceUpdate(symbol, parseFloat(price));
        }
    } catch (error) {
        console.error('Error parsing WebSocket message:', error);
    }
});

ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});

ws.on('close', () => {
    console.log('WebSocket connection closed');
});

// Express server start
app.listen(port, (resp) => {
    console.log(`Server is running on port ${port} : ${resp}`);

    bot.onText(/\/list/, async (msg) => {
        const chatId = msg.chat.id;
        const chatUser = msg.from.username;
        listUserAlerts(chatId, chatUser);
    });


});



bot.onText(/\/above (.+) (.+)/, async (msg, match) => {
    handleUserAlert(msg.chat.id, match, 'alert_above');
});

bot.onText(/\/below (.+) (.+)/, async (msg, match) => {
    handleUserAlert(msg.chat.id, match, 'alert_below');
});

bot.onText(/\/delete_(.+)/, async (msg, match) => {
    deleteUserAlert(msg.chat.id, match[1].toUpperCase());
});

bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    const chatUser = msg.from.username;
    listUserAlerts(chatId, chatUser);
});
// Function to handle user alerts
const handleUserAlert = async (chatId: number, match: RegExpExecArray | null, alertType: 'alert_above' | 'alert_below') => {
    if (!match) return;

    const symbol = match[1].toUpperCase();
    const price = parseFloat(match[2]);

    try {
        const alerts = await redisClient.hGet(alertType, chatId.toString());
        const userAlerts = alerts ? JSON.parse(alerts) : {};
        userAlerts[symbol] = price;
        await redisClient.hSet(alertType, chatId.toString(), JSON.stringify(userAlerts));
        await bot.sendMessage(chatId, `Alert set for ${symbol} at $${price}`);
    } catch (error) {
        console.error('Error setting alert:', error);
        await bot.sendMessage(chatId, 'Failed to set alert. Please try again later.');
    }
};

// Function to delete a user alert
const deleteUserAlert = async (chatId: number, symbol: string) => {
    try {
        const alertTypes = ['alert_above', 'alert_below'] as const;

        for (const alertType of alertTypes) {
            const alerts = await redisClient.hGet(alertType, chatId.toString());
            if (alerts) {
                const userAlerts = JSON.parse(alerts);
                delete userAlerts[symbol];
                await redisClient.hSet(alertType, chatId.toString(), JSON.stringify(userAlerts));
            }
        }

        await bot.sendMessage(chatId, `Alert deleted for ${symbol}`);
    } catch (error) {
        console.error('Error deleting alert:', error);
        await bot.sendMessage(chatId, 'Failed to delete alert. Please try again later.');
    }
};

// Function to list all user alerts
const listUserAlerts = async (chatId: number, username: string) => {
    try {
        const [alertAbove, alertBelow] = await Promise.all([
            redisClient.hGet('alert_above', chatId.toString()),
            redisClient.hGet('alert_below', chatId.toString()),
        ]);

        const userAlertAbove = alertAbove ? JSON.parse(alertAbove) : {};
        const userAlertBelow = alertBelow ? JSON.parse(alertBelow) : {};

        if (Object.keys(userAlertAbove).length === 0 && Object.keys(userAlertBelow).length === 0) {
            await bot.sendMessage(chatId, 'You have no alerts set.');
        } else {
            const alertsListA = Object.entries(userAlertAbove)
                .map(([symbol, price]) => `${symbol}: $${price}`)
                .join('\n');
            const alertsListB = Object.entries(userAlertBelow)
                .map(([symbol, price]) => `${symbol}: $${price}`)
                .join('\n');

            await bot.sendMessage(chatId, `Your alerts @${username}\nAbove\n${alertsListA}\nBelow\n${alertsListB}`);
        }
    } catch (error) {
        console.error('Error listing alerts:', error);
        await bot.sendMessage(chatId, 'Failed to list alerts. Please try again later.');
    }
};

// Graceful shutdown function
const shutdown = async () => {
    console.log('Shutting down gracefully...');
    try {
        await redisClient.quit();
        console.log('Redis client disconnected');
    } catch (error) {
        console.error('Error disconnecting Redis client:', error);
    }

    if (ws.readyState === WebSocket.OPEN) {
        ws.close();
        console.log('WebSocket connection closed');
    }

    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
