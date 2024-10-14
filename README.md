# ld-test-fdn

A simple NodeJS app to test LaunchDarkly's Flag Delivery Network performance.

This test measures the time it takes for a flag change in LaunchDarkly SaaS to reach client code.

Test logic:

1. Toggle the flag with the given `flagKey` in LaunchDarkly (via [Flags PATCH API call](https://apidocs.launchdarkly.com/tag/Feature-flags#operation/patchFeatureFlag))
2. Get the flag's `lastModified` timestamp value from the API call response
3. Get a current timestamp when the LDClient's `on('update:myFlagKey')` handler fires
4. Compare the the two timestamps

# Setup

```bash
npm i
```

Update the following values in your `.env` file (or pass them in via command line args)

```
LD_SDK_KEY=<your SDK key>
LD_API_TOKEN=<your API token>
LD_PROJECT=<your LD project key>
LD_ENVIRONMENT=<your LD environment key>
LD_FLAG_KEY=<your LD flag key>
LD_CONTEXT=<your LD context object>
```

# Run

If using parameters in a `.env` file:

```bash
node app.mjs
```

If passing values via args:

```bash
node app.mjs --sdkKey abc123 --apiToken asdf etc etc
```

To see the full list of available parameters:

```bash
node app.mjs --help
```
