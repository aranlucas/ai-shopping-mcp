import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import dotenv from "dotenv";
import express from "express";
import {
  setupMCPEndpoint,
  setupMessageEndpoint,
  setupSSEEndpoint,
} from "./modules/transports";
import { registerCartTools } from "./tools/cartTools";
import { registerLocationTools } from "./tools/locationTools";
import { registerProductTools } from "./tools/productTools";

dotenv.config();

const server = new McpServer({
  name: "kroger-ai-assistant",
  description:
    "A Kroger AI Assistant that helps users find products, add items to their cart, and locate stores.",
  version: "1.0.0",
});

// Register tools and prompts
registerCartTools(server);
registerLocationTools(server);
registerProductTools(server);

const app = express();

// Setup endpoints
setupMCPEndpoint(app, server);
setupSSEEndpoint(app, server);
setupMessageEndpoint(app);

const port = Number.parseInt(process.env.PORT || "4000", 10);
app.listen(port, () => {
  console.log(`MCP server is running on port ${port}`);
});
