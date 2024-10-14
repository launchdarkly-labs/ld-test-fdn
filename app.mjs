'use strict';

import { performance, PerformanceObserver } from 'node:perf_hooks'
import dotenv from 'dotenv';
import * as ld from '@launchdarkly/node-server-sdk';
import readline from 'readline';
import fetch from 'node-fetch';
import { program } from 'commander';
import { ansi256 } from 'ansis';
import ora from 'ora';

(async () => {
    dotenv.config();

    const about = 'This app measures the time to receive notification in client after a flag toggle.\n' +
        'Use --help to see available parameters. If no args are provided, the app will attempt to use values in .env file.\n' +
        'When ready, press "t" to run the test.\n'

    program
        .description(about)
        .option('--sdkKey <sdkKey>', 'SDK key for the target LaunchDarkly Environment', null)
        .option('--apiToken <apiToken>', 'The LaunchDarkly API token', null)
        .option('--logLevel <logLevel>', 'The LaunchDarkly SDK logging level (debug, error, info, warn, none)', 'info')
        .option('--projectKey <projectKey>', 'The LaunchDarkly Project key', null)
        .option('--environmentKey <environmentKey>', 'The LaunchDarkly Environment key', null)
        .option('--flagKey <flagKey>', 'The LaunchDarkly flag key to be toggled', null)
        .option('--context <context>', 'The LaunchDarkly context used in SDK initialization', null)
        .parse(process.argv);

    const options = program.opts();
    const sdkKey = options.sdkKey || process.env.LD_SDK_KEY;
    const apiToken = options.apiToken || process.env.LD_API_TOKEN;
    const projectKey = options.projectKey || process.env.LD_PROJECT;
    const environmentKey = options.environmentKey || process.env.LD_ENVIRONMENT;
    const flagKey = options.flagKey || process.env.LD_FLAG_KEY;
    const context = options.context ? JSON.parse(options.context) : JSON.parse(process.env.LD_CONTEXT);
    const og = console.log;
    const ldOptions = {
        logger: ld.basicLogger({
            level: options.logLevel,
            destination: logInfo
        })
    };
    new PerformanceObserver((list, observer) => {
        list.getEntries().forEach((entry) => {
            logInfo(`${entry.name} took ${entry.duration} ms`);
        });
        performance.clearMarks();
        performance.clearMeasures();
    }).observe({ entryTypes: ["measure"], buffer: true })

    const info = ansi256(50).bold;
    const error = ansi256(198).bold;
    const spinner = ora();
    spinner.color = 'green';

    let client;
    let flagValue;
    let flagLastModifiedInLD;
    let testCount = 0;
    let testIsRunning = false;
    let runningAverage = 0;

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', keyPressed);

    async function init() {
        try {
            // measure time to initialize the SDK
            console.time('LaunchDarkly SDK Initialization');
            client = ld.init(sdkKey, ldOptions);
            await client.waitForInitialization({ timeout: 10 });
            console.timeEnd('LaunchDarkly SDK Initialization');

            // measure time to retrieve a flag after initialization
            console.time('Initial flag retrieval after SDK initialization');
            flagValue = await client.boolVariation(flagKey, context, false);
            console.timeEnd('Initial flag retrieval after SDK initialization');

            // ready to run test
            showReadyMessage();
        } catch (e) {
            logError(`Error initializing app: ${e}`);
            logInfo('Exiting app...');
            process.exit();
        }
    }

    async function keyPressed(str, key) {
        if (key.ctrl && key.name == 'c') { // kill the app
            spinner.stop();
            logInfo('Exiting app...');
            process.exit();
        } else if (key.name == 't') {
            if (!testIsRunning) {
                spinner.stop();
                await runFlagChangeDeliveryTest();
            }
        }
    }

    async function runFlagChangeDeliveryTest() {
        try {
            testIsRunning = true;
            if (testCount == 0) {
                client.on(`update:${flagKey}`, async () => {
                    const toggleReceivedDateTime = new Date(new Date().toUTCString());
                    const waitTime = 3000;
                    logInfo(`Flag update received by client at ${toggleReceivedDateTime.toISOString()}`);
                    setTimeout(() => {
                        const flagLastModifiedInLDDateTime = new Date(flagLastModifiedInLD);
                        logInfo(`Flag last updated in LD at ${flagLastModifiedInLDDateTime.toISOString()}`);
                        const diff = Math.abs(toggleReceivedDateTime.getTime() - flagLastModifiedInLDDateTime.getTime());
                        logInfo(`Time to deliver flag change to client: ${diff} ms`);
                        runningAverage = (runningAverage + diff) / testCount;
                        logInfo(`Average flag delivery time: ${runningAverage} ms`);
                        testIsRunning = false;
                        showReadyMessage();
                    }, waitTime);
                });
                client.on('error', (err) => {
                    logError(`LDClient error: ${err}`);
                    testIsRunning = false;
                    throw err;
                });
            }
            ++testCount
            logInfo(`Executing test run #${testCount}`);

            // toggle the flag in LD
            await toggleFlag(flagValue);
        } catch (e) {
            logError(`Error running test: ${e}`);
            testIsRunning = false;
        }
    }

    async function toggleFlag(currentFlagValue) {
        logInfo('Toggling flag in LD...');
        try {
            const kind = currentFlagValue ? 'turnFlagOff' : 'turnFlagOn';
            const ignoreConflicts = true; // force it
            performance.mark('toggleFlag-start');
            const response = await fetch(`https://app.launchdarkly.com/api/v2/flags/${projectKey}/${flagKey}?ignoreConflicts=${ignoreConflicts}&filterEnv=${environmentKey}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json; domain-model=launchdarkly.semanticpatch',
                        Authorization: `${apiToken}`
                    },
                    body: JSON.stringify({
                        'environmentKey': `${environmentKey}`,
                        'instructions': [{ 'kind': kind }]
                    })
                });
            if (!response.ok) {
                const msg = `${response.status} ${response.statusText}`;
                throw new Error(msg);
            }
            const json = await response.json();
            const state = json.environments[`${environmentKey}`];
            flagValue = state.on;
            flagLastModifiedInLD = state.lastModified;
        } catch (e) {
            logError(`Error toggling flag: ${e}`);
            throw e;
        } finally {
            performance.mark('toggleFlag-end');
            performance.measure('Toggling flag in LD', 'toggleFlag-start', 'toggleFlag-end');
        }
    }

    function showReadyMessage() {
        spinner.text = "Ready to run test. Press 't' to start.";
        spinner.start();
    }

    function logInfo(message, ...args) {
        const options = {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            fractionalSecondDigits: 3
        };
        const stamp = new Date().toLocaleTimeString('en-US', options).replace(" ", "").replace(",", " ");
        og(`${stamp} ${info("INFO")} ${message}`, ...args);
    }

    function logError(message, ...args) {
        const options = {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            fractionalSecondDigits: 3
        };
        const stamp = new Date().toLocaleTimeString('en-US', options).replace(" ", "").replace(",", " ");
        og(`${stamp} ${error("ERRO")} ${message}`, ...args);
    }

    console.log = logInfo;
    console.error = logError;

    await init();
})();