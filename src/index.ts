import { App } from "@slack/bolt";
import { MessageElement } from "@slack/web-api/dist/types/response/ConversationsHistoryResponse";
import { OpenAI } from "openai";

const dotenv = require("dotenv");

dotenv.config({
  path: [".env.local", ".env", ".env.development.local", ".env.development"],
});

// Set your OpenAI and Slack tokens as environment variables
const openaiApiKey = process.env.OPENAI_API_KEY as string;
const slackToken = process.env.SLACK_BOT_TOKEN as string;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET as string;
const organization = process.env.OPENAI_ORGANIZATION_ID as string;
const project = process.env.OPENAI_PROJECT_ID as string;

if (process.env.NODE_ENV === "development") {
  console.log("OpenAI API Key:", openaiApiKey);
  console.log("Slack Bot Token:", slackToken);
  console.log("Slack Signing Secret:", slackSigningSecret);
  console.log("OpenAI Organization ID:", organization);
  console.log("OpenAI Project ID:", project);
}

const openai = new OpenAI({
  organization,
  project,
  apiKey: openaiApiKey,
});

const app = new App({
  token: slackToken,
  signingSecret: slackSigningSecret,
});

interface SlackMessage {
  text: string;
  user: string;
  channel: string;
  thread_ts?: string;
}

async function fetchRecentMessages(
  channelId: string,
  limit: number = 10,
  thread_ts?: string
): Promise<SlackMessage[]> {
  try {
    let result;
    if (thread_ts) {
      result = await app.client.conversations.replies({
        channel: channelId,
        ts: thread_ts,
        limit: limit,
      });
    } else {
      result = await app.client.conversations.history({
        channel: channelId,
        limit: limit,
      });
    }

    if (result.messages) {
      const s: MessageElement[] = result.messages as MessageElement[];
      return result.messages as SlackMessage[];
    } else {
      return [];
    }
  } catch (error) {
    console.error(`Error fetching messages: ${error}`);
    return [];
  }
}

const systemPrompt: {
  role: "system";
  content: string;
} = {
  role: "system",
  content:
    "You are a helpful assistant. You will summarize the conversation using the language of the input. You should look into all the external resources and summarize the conversation.",
};

async function summarizeText(chats: SlackMessage[]): Promise<string> {
  try {
    const messages: {
      role: "user";
      content: string;
      user: string;
    }[] = [];
    for (const chat of chats) {
      const userInfo = await app.client.users.info({
        user: chat.user,
      });
      messages.push({
        role: "user",
        content: chat.text,
        user: userInfo.user?.name || "Unknown",
      });
    }
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [systemPrompt, ...messages],
    });
    return chatCompletion.choices[0].message.content || "No summary found.";
  } catch (error) {
    console.error(`Error summarizing text: ${error}`);
    return "Error summarizing text.";
  }
}

async function postMessage(
  channelId: string,
  text: string,
  threadTs?: string
): Promise<void> {
  try {
    await app.client.chat.postMessage({
      channel: channelId,
      text: text,
      thread_ts: threadTs,
    });
  } catch (error) {
    console.error(`Error posting message: ${error}`);
  }
}

async function handleSummarizeRequest(channelId: string, threadTs?: string) {
  const messages = await fetchRecentMessages(channelId, 10, threadTs);
  if (messages.length > 0) {
    console.log(messages.map((m) => m.user));
    const summary = await summarizeText(messages);

    if (threadTs) {
      // Post in the same thread
      await postMessage(channelId, `${summary}`, threadTs);
    } else {
      // Post in the channel
      await postMessage(channelId, `${summary}`);
    }
  }
}

app.message("!summarize", async ({ message, say }) => {
  try {
    const { channel, thread_ts } = message as SlackMessage;
    const messages = await fetchRecentMessages(channel, 10, thread_ts);
    if (messages.length > 0) {
      await handleSummarizeRequest(channel, thread_ts);
    }
  } catch (error) {
    console.error(`Error handling message event: ${error}`);
  }
});

(async () => {
  // Start your app
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Slack Bolt app is running on port ${port}!`);
})();
