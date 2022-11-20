import axios from 'axios';
import axiosRetry from 'axios-retry';

// Retry webhook 5 times with exponential delay if the first request fails
axiosRetry(axios, {retries: 5, retryDelay: axiosRetry.exponentialDelay});

export async function sendWebhook(webhookUrl:string, data:any) {
  try {
    await axios.post(webhookUrl, data);
  } catch (error) {
    console.error('All webhook retries failed to', webhookUrl);
  }
}
