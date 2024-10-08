import path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

const catSim = new cdk.Stack(new cdk.App(), "Cat-Simulator", { env: { region: 'us-east-1' } });
const catSimApi = new Construct(catSim, 'Cat Simulator Api');
const catSimStore = new Construct(catSim, 'Cat Simulator Storage');
const catSimInterface = new Construct(catSim, 'Cat Simulator Interface');
const catSimAuthencation = new Construct(catSim, 'Cat Simulator Authencation');

const websiteBucket = new cdk.aws_s3.Bucket(catSimStore, "Web Interface", {
    autoDeleteObjects: true,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
});

new cdk.aws_s3_deployment.BucketDeployment(catSimStore, "Bucket interface deployment", {
    sources: [cdk.aws_s3_deployment.Source.asset(path.join(__dirname, '../build'))],
    destinationBucket: websiteBucket,
    retainOnDelete: false,
    extract: true,
});

const chatTable = new cdk.aws_dynamodb.Table(catSimStore, 'Chat Table', {
    readCapacity: 3,
    writeCapacity: 3,
    partitionKey: {
        name: 'chatId',
        type: cdk.aws_dynamodb.AttributeType.STRING
    },
    sortKey: {
        name: 'timestamp',
        type: cdk.aws_dynamodb.AttributeType.NUMBER
    },
    timeToLiveAttribute: 'ttl',
    deletionProtection: true,
    billingMode: cdk.aws_dynamodb.BillingMode.PROVISIONED,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const userPool = new cdk.aws_cognito.UserPool(catSimAuthencation, 'User pool for auth', {
    accountRecovery: cdk.aws_cognito.AccountRecovery.EMAIL_ONLY,
    autoVerify: { email: true },
    deletionProtection: true,
    deviceTracking: {
        deviceOnlyRememberedOnUserPrompt: true,
        challengeRequiredOnNewDevice: true,
    },
    email: cdk.aws_cognito.UserPoolEmail.withCognito(),
    selfSignUpEnabled: true,
    mfa: cdk.aws_cognito.Mfa.OPTIONAL,
    userVerification: {
        emailSubject: 'Verify your email for cat messenger!',
        emailBody: 'Thanks for signing up to cat messenger! Visit/click the link below to varify your email\n <a href="{##Verify Email##}">here</a>',
        emailStyle: cdk.aws_cognito.VerificationEmailStyle.LINK,
    },
    standardAttributes: {
        preferredUsername: { required: true, mutable: false },
        email: { required: true, mutable: false }
    },
});

// userPool.addDomain('User Pool Domain', { cognitoDomain: { domainPrefix: crypto.createHash('md5').update(catSim.account + catSim.stackId.replace('-', '')).digest("hex") } });
const userPoolClient = userPool.addClient('User Pool Client', {
    authFlows: {
        adminUserPassword: false,
        userSrp: false,
        userPassword: true,
        custom: false,
    },
    generateSecret: false,
});

const apiAuthFunction = new cdk.aws_lambda.Function(catSimAuthencation, 'Api Auth Function', {
    runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
    code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '/api-auth-lambda')),
    handler: 'index.handler',
    timeout: cdk.Duration.seconds(10),
    environment: {
        "USER_POOL_ID": userPool.userPoolId,
        "CLIENT_ID": userPoolClient.userPoolClientId,
    },
});

new cdk.aws_logs.LogGroup(catSimAuthencation, 'Api Auth LogGroup', {
    logGroupName: `/aws/lambda/${apiAuthFunction.functionName}`,
    retention: cdk.aws_logs.RetentionDays.ONE_DAY,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const apiChatFunction = new cdk.aws_lambda.Function(catSimApi, 'Api Function', {
    runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
    code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, './api-lambda')),
    handler: 'index.handler',
    timeout: cdk.Duration.seconds(30),
    environment: {
        CHAT_TABLE_NAME: chatTable.tableName,
    },
});

apiChatFunction.role?.attachInlinePolicy(new cdk.aws_iam.Policy(catSimApi, 'Bedrock policy for api', {
    statements: [new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: ['*'],
    }),],
}));

apiChatFunction.role?.attachInlinePolicy(new cdk.aws_iam.Policy(catSimApi, 'Dynamo DB policy for api', {
    statements: [new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"],
        resources: [chatTable.tableArn],
    }),],
}));

new cdk.aws_logs.LogGroup(catSimApi, 'Api LogGroup', {
    logGroupName: `/aws/lambda/${apiChatFunction.functionName}`,
    retention: cdk.aws_logs.RetentionDays.ONE_DAY,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const apiChatExportFunction = new cdk.aws_lambda.Function(catSimApi, 'Api Export Function', {
    runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
    code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, './api-export-lambda')),
    handler: 'index.handler',
    timeout: cdk.Duration.seconds(30),
    environment: {
        CHAT_TABLE_NAME: chatTable.tableName,
    },
});

apiChatExportFunction.role?.attachInlinePolicy(new cdk.aws_iam.Policy(catSimApi, 'Dynamo DB policy for api export', {
    statements: [new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["dynamodb:Query"],
        resources: [chatTable.tableArn],
    }),],
}));

new cdk.aws_logs.LogGroup(catSimApi, 'Api Export LogGroup', {
    logGroupName: `/aws/lambda/${apiChatExportFunction.functionName}`,
    retention: cdk.aws_logs.RetentionDays.ONE_DAY,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const DEFAULT_API_CORS = {
    allowOrigins: ['*'],
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
}
const api = new cdk.aws_apigateway.RestApi(catSimApi, 'Api for cat sim');
const apiRoot = api.root.addResource('api');
const apiChat = apiRoot.addResource('chat', {
    defaultCorsPreflightOptions: DEFAULT_API_CORS,
});
apiChat.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(apiChatFunction));
const apiChatExport = apiChat.addResource('export', {
    defaultCorsPreflightOptions: DEFAULT_API_CORS,
});
apiChatExport.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(apiChatExportFunction));
const apiUserAuth = apiRoot.addResource('auth', {
    defaultCorsPreflightOptions: DEFAULT_API_CORS,
});
apiUserAuth.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(apiAuthFunction));

const dist = new cdk.aws_cloudfront.Distribution(catSimInterface, "Distribution for Site", {
    defaultRootObject: 'index.html',
    defaultBehavior: {
        origin: cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        edgeLambdas: [{
            functionVersion: new cdk.aws_cloudfront.experimental.EdgeFunction(catSimInterface, 'url remapping', {
                handler: 'index.handler',
                runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
                code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, 'url-rewrite'))
            }).currentVersion,
            eventType: cdk.aws_cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
        }]
    },
    additionalBehaviors: {
        '/api/*': {
            origin: new cdk.aws_cloudfront_origins.RestApiOrigin(api, {
                originPath: '/prod',
            }),
            cachePolicy: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED,
            viewerProtocolPolicy: cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_ALL,
        }
    },
});

new cdk.CfnOutput(catSim, 'CloudfrontDistributionUrl', {
    value: `https://${dist.distributionDomainName}/`,
});

new cdk.CfnOutput(catSim, 'CloudfrontDistributionID', {
    value: dist.distributionId,
});
