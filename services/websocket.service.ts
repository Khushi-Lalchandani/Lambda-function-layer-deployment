import { ApiGatewayManagementApi } from 'aws-sdk';

export class WebSocketService {
  private api: ApiGatewayManagementApi;

  constructor() {
    this.api = new ApiGatewayManagementApi({
      endpoint: process.env.WS_ENDPOINT!,
    });
  }

  async send(connectionId: string, payload: any) {
    try {
      await this.api
        .postToConnection({
          ConnectionId: connectionId,
          Data: JSON.stringify(payload),
        })
        .promise();
    } catch (error: any) {
      console.error('WebSocket Send Error:', error);
    }
  }
}
