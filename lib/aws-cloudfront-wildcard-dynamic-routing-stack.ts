import { Stack, StackProps } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  CachedMethods,
  CachePolicy,
  Distribution,
  experimental,
  LambdaEdgeEventType,
  OriginAccessIdentity,
  OriginRequestPolicy,
  PriceClass,
  ViewerProtocolPolicy
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import { AaaaRecord, ARecord, IPublicHostedZone, PublicHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Duration } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

export const fallbackBucketName = 'A_UNIQUE_FALLBACK_BUCKET_NAME_YOU_WILL_USE_THIS_ON_ORIGIN_REQUEST_LAMBDA'; // fallback-bucket-1928378
export const hostedZoneId = 'THE_HOSTED_ZONE_ID_OF_YOUR_DOMAIN'; // Z1234567890
export const domainName = 'YOUR_DOMAIN_NAME'; // example.com
export const wildCardDomainName = '*.YOUR_DOMAIN_NAME'; // *.example.com

export class AwsCloudfrontWildcardDynamicRoutingStack extends Stack {
  private readonly hostedZone: IPublicHostedZone;
  private readonly certificate: Certificate;
  private readonly fallbackBucket: Bucket;
  private readonly originRequestLambda: experimental.EdgeFunction;
  private readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.hostedZone = this.getHostedZoned();
    this.certificate = this.createCertificate();
    this.originRequestLambda = this.createOriginRequestLambda();
    this.fallbackBucket = this.createFallbackBucket();
    this.distribution = this.createDistribution();
    this.createDnsRecords();
  }

  private getHostedZoned() {
    return PublicHostedZone.fromPublicHostedZoneAttributes(this, 'hosted-zone', {
      hostedZoneId: hostedZoneId,
      zoneName: domainName
    });
  }

  private createCertificate() {
    return new Certificate(this, 'certificate', {
      domainName: wildCardDomainName, // the certificate also needs to be wildcard
      validation: CertificateValidation.fromDns(this.hostedZone)
    });
  }

  private createOriginRequestLambda() {
    return new experimental.EdgeFunction(this, 'origin-request-lambda', {
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5), // this is more than enough for the lambda to run
      handler: 'origin-request.handler',
      code: Code.fromAsset('src')
    });
  }

  private createFallbackBucket() {
    return new Bucket(this, 's3-bucket', {
      bucketName: fallbackBucketName,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: '404.html'
    });
  }

  private createDistribution() {
    // every CDN needs a default Origin
    // in this case we use this S3 bucket as the default origin,
    // but it will never be accessed because all requests will be intercepted by the Lambda@Edge
    // that will use the correct service as the origin
    const originAccessIdentity = new OriginAccessIdentity(this, 'origin-access-identity');
    this.fallbackBucket.grantRead(originAccessIdentity);
    const defaultOrigin = new S3Origin(this.fallbackBucket, { originAccessIdentity });

    return new Distribution(this, 'broker', {
      certificate: this.certificate,
      domainNames: [wildCardDomainName],
      priceClass: PriceClass.PRICE_CLASS_ALL,

      defaultBehavior: {
        origin: defaultOrigin,
        compress: true,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,

        edgeLambdas: [
          {
            // the lambda that will intercept the requests and instruct the cloudfront
            // to make the request to the correct service
            eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
            functionVersion: this.originRequestLambda.currentVersion
          }
        ]
      }
    });
  }

  private createDnsRecords() {
    // DNS record for the wildcard domain requests
    const cloudFrontTarget = new CloudFrontTarget(this.distribution);
    const target = RecordTarget.fromAlias(cloudFrontTarget);
    new ARecord(this.distribution, 'a-record', {
      recordName: '*',
      zone: this.hostedZone,
      target
    });
    new AaaaRecord(this.distribution, 'aaaa-record', {
      recordName: '*',
      zone: this.hostedZone,
      target
    });
  }
}
