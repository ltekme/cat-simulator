import { DynamoDBClient, QueryCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb"

/*
Expected Message Object
{
    chatId: 'e9f34e10-6c34-4ba0-92cf-797e67f897f8',
    timestamp: 1725965682,
    message: bedrock message object,
    ttl: 1725965682,

    if ttl is not specified, will set to one dat later
    if no sender or invalid sender, set to user
}
*/

export class Message {
    chatId;
    timestamp;
    message;
    ttl;
    constructor(item) {
        this.chatId = item.chatId;
        this.timestamp = !isNaN(new Date(item.timestamp).getTime()) ? new Date(item.timestamp).getTime() : new Date().getTime();
        this.message = item.message ? item.message : {};
        this.ttl = !isNaN(new Date(item.ttl).getTime()) ? new Date(item.ttl).getTime() : Math.floor(new Date(new Date().setDate(new Date().getDate() + 1)).getTime() / 1000);
    }
    out = () => {
        return {
            chatId: this.chatId,
            timestamp: this.timestamp,
            message: this.message,
            ttl: this.ttl,
        }
    }
}

export const getPastMessagesFromChatId = async (chatId) => {
    const client = new DynamoDBClient();
    const response = await client.send(new QueryCommand({
        TableName: process.env.CHAT_TABLE_NAME,
        ScanIndexForward: true,
        KeyConditionExpression: 'chatId = :chatId',
        ExpressionAttributeValues: {
            ":chatId": {
                "S": chatId,
            },
        },
    }));
    console.log('From Dynamo DB\n', JSON.stringify(response))
    let items = [];

    for (let item of response.Items) {
        let unmarshalledItem = unmarshall(item);
        let message = new Message(unmarshalledItem).out();
        items.push(message);
    }

    return items;
};

export const putNewMessageToChat = async (chatId, message, timestamp, ttl) => {
    const isAssistant = message.role === 'assistant' ? true : false
    const client = new DynamoDBClient();
    const response = await client.send(new PutItemCommand({
        TableName: process.env.CHAT_TABLE_NAME,
        ScanIndexForward: true,
        Item: marshall(new Message({
            chatId: chatId,
            message: message,
            timestamp: isAssistant ? timestamp + 1 : timestamp,
            ttl: ttl
        }).out()),
    }));
    console.log(response);
    return response
};

export const updateChatTTL = async (chatId, timestamp, newTTL) => {
    const client = new DynamoDBClient();
    // const 

}

// TODO: Delete Chat
// export const deleteChat = async (chatId)

// testing plain
// let chatId = '2c23fe40-ca04-43f8-97a3-a77a746e92f1';
// let response = await putNewMessageToChat(chatId, {
//     role: 'assistant',
//     toolResult: {
//         toolUseId: 'abcdefg',
//         content: [{ json: { message: 'hi', soundtracks: ['meow'] } }]
//     },
//     content: [{ text: { message: 'hi', soundtracks: ['meow'] }.message }]
// }, false);

// let response2 = await getPastMessagesFromChatId(chatId);
// console.log(JSON.stringify(response2))