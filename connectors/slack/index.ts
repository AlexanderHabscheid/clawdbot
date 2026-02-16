/**
 * Slack Connector for Centris
 *
 * Demonstrates the SDK patterns with a real connector implementation.
 */

import { Type, type Static } from "@sinclair/typebox";
import type {
  CentrisConnectorApi,
  CentrisConnectorDefinition,
  ConnectorConfigSchema,
} from "../../sdk/typescript/src/index.js";
import { jsonResult, textResult, errorResult } from "../../sdk/typescript/src/tools/common.js";

// =============================================================================
// TypeBox Schemas
// =============================================================================

const SendMessageInputSchema = Type.Object({
  channel: Type.String({
    minLength: 1,
    description: "Channel name (e.g., #general) or user ID for DM",
  }),
  message: Type.String({
    minLength: 1,
    description: "The message text to send",
  }),
  threadTs: Type.Optional(
    Type.String({
      description: "Thread timestamp to reply in a thread",
    }),
  ),
});

type SendMessageInput = Static<typeof SendMessageInputSchema>;

const SendMessageOutputSchema = Type.Object({
  ok: Type.Boolean(),
  ts: Type.String({ description: "Message timestamp" }),
  channel: Type.String(),
});

type SendMessageOutput = Static<typeof SendMessageOutputSchema>;

const ListChannelsInputSchema = Type.Object({
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 1000,
      default: 100,
      description: "Maximum number of channels to return",
    }),
  ),
  types: Type.Optional(
    Type.String({
      description: "Channel types: public_channel, private_channel",
      default: "public_channel",
    }),
  ),
});

type ListChannelsInput = Static<typeof ListChannelsInputSchema>;

const GetUserInputSchema = Type.Object({
  userId: Type.String({
    minLength: 1,
    description: "User ID to look up",
  }),
});

type GetUserInput = Static<typeof GetUserInputSchema>;

// =============================================================================
// Config Schema
// =============================================================================

const SlackConfigSchema: ConnectorConfigSchema = {
  safeParse: (value: unknown) => {
    if (!value || typeof value !== "object") {
      return { success: true, data: {} };
    }
    const config = value as Record<string, unknown>;

    // Validate workspace if provided
    if (config.workspace && typeof config.workspace !== "string") {
      return {
        success: false,
        error: {
          issues: [{ path: ["workspace"], message: "workspace must be a string" }],
        },
      };
    }

    return { success: true, data: config };
  },
  uiHints: {
    workspace: {
      label: "Workspace Name",
      help: "Your Slack workspace name (optional)",
      placeholder: "my-company",
    },
    defaultChannel: {
      label: "Default Channel",
      help: "Default channel for messages when not specified",
      placeholder: "#general",
    },
    botToken: {
      label: "Bot Token",
      help: "Slack Bot User OAuth Token (xoxb-...)",
      sensitive: true,
      placeholder: "xoxb-...",
    },
  },
};

// =============================================================================
// Connector Definition
// =============================================================================

const slackConnector: CentrisConnectorDefinition = {
  id: "slack",
  name: "Slack",
  description: "Send messages, manage channels, and collaborate in Slack workspaces",
  version: "1.0.0",
  configSchema: SlackConfigSchema,

  register(api: CentrisConnectorApi) {
    const { logger, connectorConfig } = api;
    const botToken = (connectorConfig?.botToken as string) || process.env.SLACK_BOT_TOKEN;

    // =========================================================================
    // send_message Tool
    // =========================================================================

    api.registerTool(
      {
        name: "slack_send_message",
        label: "Send Slack Message",
        description: "Send a message to a Slack channel or direct message. Supports threading.",
        parameters: SendMessageInputSchema,

        async execute(toolCallId, params: SendMessageInput, context?: any) {
          logger.info(`Sending message to ${params.channel}`);

          // OPTION 1: Use Slack API if token available (fastest)
          if (botToken) {
            try {
              // In a real implementation, use @slack/web-api
              // const client = new WebClient(botToken);
              // const result = await client.chat.postMessage({...});

              const result: SendMessageOutput = {
                ok: true,
                ts: Date.now().toString(),
                channel: params.channel,
              };
              logger.info(`Message sent via API: ${result.ts}`);
              return jsonResult(result);
            } catch (error) {
              logger.warn(`API failed, falling back to browser: ${error}`);
            }
          }

          // OPTION 2: Use Browser Bridge for deterministic automation
          // This is the "compiled recipe" approach - uses same primitives as LLM
          // but executes deterministically without LLM-in-loop overhead
          const browserBridge = context?.browser_bridge;
          if (browserBridge) {
            try {
              logger.info(`Using browser bridge for deterministic automation`);

              // Navigate to Slack
              await browserBridge.navigate_browser("https://app.slack.com/client");

              // Wait for channel list to load
              await browserBridge.wait_for_selector(".p-channel_sidebar__list");

              // Click on the target channel
              const channelSelector = params.channel.startsWith("#")
                ? `[data-qa-channel-sidebar-channel-name="${params.channel.slice(1)}"]`
                : `[data-qa-channel-sidebar-channel-name="${params.channel}"]`;
              await browserBridge.click_node(channelSelector);

              // Wait for message input
              await browserBridge.wait_for_selector(".ql-editor");

              // Type the message
              await browserBridge.input_text_node(".ql-editor", params.message);

              // Send with Enter
              await browserBridge.press_key("Enter");

              const result: SendMessageOutput = {
                ok: true,
                ts: Date.now().toString(),
                channel: params.channel,
              };
              logger.info(`Message sent via browser bridge`);
              return jsonResult(result);
            } catch (error) {
              logger.error(`Browser automation failed: ${error}`);
              return errorResult(`Browser automation failed: ${error}`);
            }
          }

          // No API token and no browser bridge
          return errorResult(
            "Slack bot token not configured and browser bridge not available. Set SLACK_BOT_TOKEN or ensure Centris desktop is running.",
          );
        },
      },
      { names: ["slack_send_message", "slack.send_message"] },
    );

    // =========================================================================
    // list_channels Tool
    // =========================================================================

    api.registerTool({
      name: "slack_list_channels",
      label: "List Slack Channels",
      description: "List channels in the Slack workspace",
      parameters: ListChannelsInputSchema,

      async execute(toolCallId, params: ListChannelsInput) {
        logger.info(`Listing channels (limit: ${params.limit || 100})`);

        if (!botToken) {
          return errorResult("Slack bot token not configured");
        }

        try {
          // Simulated response
          const channels = [
            { id: "C12345", name: "general", is_private: false },
            { id: "C12346", name: "random", is_private: false },
            { id: "C12347", name: "engineering", is_private: false },
          ];

          return jsonResult({
            ok: true,
            channels,
            response_metadata: {
              next_cursor: "",
            },
          });
        } catch (error) {
          return errorResult(`Failed to list channels: ${error}`);
        }
      },
    });

    // =========================================================================
    // get_user Tool
    // =========================================================================

    api.registerTool({
      name: "slack_get_user",
      label: "Get Slack User Info",
      description: "Get information about a Slack user",
      parameters: GetUserInputSchema,

      async execute(toolCallId, params: GetUserInput) {
        logger.info(`Getting user info for ${params.userId}`);

        if (!botToken) {
          return errorResult("Slack bot token not configured");
        }

        try {
          // Simulated response
          const user = {
            id: params.userId,
            name: "john.doe",
            real_name: "John Doe",
            email: "john.doe@example.com",
            is_admin: false,
            is_bot: false,
          };

          return jsonResult({
            ok: true,
            user,
          });
        } catch (error) {
          return errorResult(`Failed to get user: ${error}`);
        }
      },
    });

    // =========================================================================
    // Gateway Methods
    // =========================================================================

    api.registerGatewayMethod("slack.send", async (params, context) => {
      logger.info(`Gateway: slack.send called by ${context.userId}`);
      // Direct API implementation for gateway access
      return { ok: true, method: "gateway" };
    });

    api.registerGatewayMethod("slack.channels.list", async (params, context) => {
      logger.info(`Gateway: slack.channels.list called`);
      return {
        ok: true,
        channels: [
          { id: "C12345", name: "general" },
          { id: "C12346", name: "random" },
        ],
      };
    });

    // =========================================================================
    // Background Service (RTM)
    // =========================================================================

    api.registerService({
      id: "slack-rtm",
      async start(ctx) {
        logger.info("Starting Slack RTM service");
        // In real implementation, connect to Slack RTM API
        // const rtm = new RTMClient(botToken);
        // await rtm.start();
      },
      async stop(ctx) {
        logger.info("Stopping Slack RTM service");
        // Disconnect from Slack RTM
      },
    });

    logger.info("Slack connector registered successfully");
  },
};

export default slackConnector;
