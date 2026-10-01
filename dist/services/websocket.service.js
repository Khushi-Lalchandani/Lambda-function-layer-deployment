"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketService = void 0;
const aws_sdk_1 = require("aws-sdk");
class WebSocketService {
    constructor() {
        this.api = new aws_sdk_1.ApiGatewayManagementApi({
            endpoint: process.env.WS_ENDPOINT,
        });
    }
    async send(connectionId, payload) {
        try {
            await this.api
                .postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify(payload),
            })
                .promise();
        }
        catch (error) {
            console.error('WebSocket Send Error:', error);
        }
    }
}
exports.WebSocketService = WebSocketService;
//# sourceMappingURL=websocket.service.js.map