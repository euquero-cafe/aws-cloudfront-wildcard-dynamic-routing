#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsCloudfrontWildcardDynamicRoutingStack } from '../lib/aws-cloudfront-wildcard-dynamic-routing-stack';

const app = new cdk.App();
new AwsCloudfrontWildcardDynamicRoutingStack(app, 'AwsCloudfrontWildcardDynamicRoutingStack', {
  env: {
    // we are required to use us-east-1 for CloudFront distributions with wildcard domains and Lambda@Edge
    region: 'us-east-1'
  }
});
