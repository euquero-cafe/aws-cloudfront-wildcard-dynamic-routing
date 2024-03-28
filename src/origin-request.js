const fallbackBucket = '<INSERT_HERE_THE_FALLBACK_BUCKET_NAME>.s3.amazonaws.com';

/**
 * This function is used to render a 404 page from the fallback bucket
 * @param request {import('aws-lambda').CloudFrontRequest}
 * @returns {import('aws-lambda').CloudFrontRequest}
 */
function notFound(request) {
  request.headers['host'] = [{ key: 'host', value: fallbackBucket }];
  request.origin = {
    s3: {
      domainName: fallbackBucket,
      authMethod: 'none',
      path: '/404.html',
      customHeaders: {}
    }
  };
  return request;
}

/**
 * This function is used to parse the tenant and service from the request
 * @param request {import('aws-lambda').CloudFrontRequest}
 * @returns { { host: string, tenantId: string, serviceId: string } }
 */
function parseTenantAndService(request) {
  const [from] = request.headers['host'];
  const host = from.value;
  const [subdomain] = host.split('.');

  const [serviceId, tenantId] = subdomain.split('-'); // <service>-<tenant>.euquero.cafe
  return { host, serviceId, tenantId };
}

/**
 * This function is used to get the service endpoint based on the subdomain (tenant and service)
 * @param tenantId {string}
 * @param serviceId {string}
 * @return {string | undefined}
 */
function getServiceEndpoint(tenantId, serviceId) {
  /**
   * We are using a static map here just for didactic purposes. In a real-world scenario
   * you would probably want to fetch this information from a database or a configuration
   * file.
   *
   * A dynamodb table would be a good fit for this use case, as it would allow you to have
   * a single table with the tenantId as the partition key and the serviceId as the sort key and
   * an endpoint field that would be the value you want to return.
   *
   * const { Item } = await ddb.get({
   *   TableName: 'service-endpoints',
   *   Key: { tenantId, serviceId }
   * });
   *
   * return Item?.endpoint;
   */
  const map = {
    // img-bear.YOUR_DOMAIN/200/300
    'img-bear': 'https://placebear.com',
    // img-dog.YOUR_DOMAIN/200/300
    'img-dog': 'https://place.dog',
    // https://search-books.YOUR_DOMAIN/search.json?q=the+lord+of+the+rings
    'search-books': 'https://openlibrary.org',
    // https://search-domains.YOUR_DOMAIN/v1/domains/search?domain=euquero&zone=cafe
    'search-domains': 'https://api.domainsdb.info',
  };

  const key = `${serviceId}-${tenantId}`;
  return map[key];
}

/**
 * This function is used to set the custom origin based on the destination
 * @param request {import('aws-lambda').CloudFrontRequest}
 * @param destination {string}
 * @return {import('aws-lambda').CloudFrontRequest}
 */
function customOrigin(request, destination) {
  // Set custom origin fields on the request
  const to = new URL(destination);
  request.origin = {
    custom: {
      domainName: to.host,
      port: 443,
      protocol: 'https',
      path: '',
      sslProtocols: ['TLSv1', 'TLSv1.1', 'TLSv1.2'],
      readTimeout: 15,
      keepaliveTimeout: 5,
      customHeaders: {}
    }
  };

  // this is important so the server receiving the request thinks it's coming directly to it from the browser
  request.headers['host'] = [{ key: 'host', value: to.host }];

  // that's it, we're done
  return request;
}

/**
 * This function is the entry point for the Lambda function. It sets the origin
 * @param event {import('aws-lambda').CloudFrontRequestEvent}
 * @returns {import('aws-lambda').CloudFrontRequest}
 */
async function handler(event) {
  const [record] = event.Records;
  const request = record.cf.request;
  const { host, tenantId, serviceId } = parseTenantAndService(request);

  if (tenantId === undefined || serviceId === undefined) {
    console.warn('Invalid subdomain, rendering 404 from bucket.', host);
    return notFound(request);
  }

  const destination = getServiceEndpoint(tenantId, serviceId);
  if (destination === undefined) {
    console.warn('Could not find endpoint for tenant/service, rendering 404 from bucket.', tenantId, serviceId);
    return notFound(request);
  }

  return customOrigin(request, destination);
}

// Export the Lambda handler
module.exports = {
  handler
};
