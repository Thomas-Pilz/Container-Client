const { DeepstreamClient } = require("@deepstream/client");
const si = require("systeminformation");
const os = require("os");
const fs = require("fs");

/**
 * Agent to gather and store live container runtime information in Deepstream.io
 * 
 * Exit codes:
 *  @returns 0: Successful execution
 *  @returns 1: Login to Deepstream failed.
 *  @returns 2: Container-ID (unique key) could not be retrieved
 * 
 * @author Thomas Pilz
 */

const deepstreamOptions = {
    // Reconnect after 10, 20 and 30 seconds
    reconnectIntervalIncrement: 10000,
    // Try reconnecting every thirty seconds
    maxReconnectInterval: 30000,
    // We never want to stop trying to reconnect
    maxReconnectAttempts: Infinity,
    // Send heartbeats only once a minute
    heartbeatInterval: 60000
};
const client = new DeepstreamClient("deepstream:6020", deepstreamOptions);

// get container id and cache it
const containerId = getContainerId();   // this container's container-ID (as given by the docker runtime on the host)
const containerListName = "containerList";  // name of the "registry" (list of registerd containers)
const sendInterval = 1000;              // interval for collecting and storing data

// Required to register (and unregister) agent. MUST be executed first.
registerExitHandler();

registerAgent();
// create record to save data in
let record = createRecord();
getRuntimeInfo();

/**
 * Register this agent with its container ID
 * @global containerList
 * @global containerId
 */
async function registerAgent() {
    await login2Deepstream().catch(err => console.error(`Registration of container ${containerId} failed with error.\n${err}`));
    const containers = await client.record.getList(containerListName).whenReady();
    containers.addEntry(`${containerListName}/${containerId}`);
    console.log(`Registration of agent with hostname (= Container-ID): ${containerId} successful.`);
}

/**
 * Unregister this agent
 * @global containerList
 * @global containerId
 */
async function unregisterAgent(signal) {
    const containers = client.record.getList(containerListName);
    containers.removeEntry(`${containerListName}/${containerId}`);
    await client.record.getRecord(`${containerId}`).delete()
        .catch(err => console.error(`Deletion of container runtime inforamtion of container ${containerId} failed.`))
    console.log(`Unregistration of agent with hostname (= Container-ID): ${containerId} successful. Reason (/Signal): ${signal}`);
}

/**
 * Register exit event handler to make sure agent ALWAYS unregisters itself before it terminates
 */
function registerExitHandler() {
    signals = ["exit","uncaughtException", "SIGINT", "SIGTERM", "SIGUSR1", "SIGUSR2", "SIGHUP"]
    signals.forEach( it => {
        process.on(it, exitHandler)
        console.log(`Handler set on ${it}`);
    });
}

/**
 * Handler method for any (un)expected exit of the program. 
 * Make sure agent ALWAYS unregisters itself.
 */
async function exitHandler(signal) {
    await unregisterAgent(signal);
    process.exit(0)
}

/**
 * Login to the Deepstream.io server
 */
async function login2Deepstream() {
    await client.login();
    if (client.getConnectionState() !== 'OPEN') {
        console.error("Login failed.");
        process.exit(1);
    }
    console.log(`Login successful.`);
    return true;
    // registerAgent();

    // client.login((success) => {
    //     console.log(success);
    //     console.log(client.getConnectionState());
    //     return success;
    // });
}

/**
 * Create a record within deepstream.io to store the container runtime information
 */
async function createRecord() {
    return await client.record.getRecord(`${containerId}`).whenReady();
}

async function sendRuntimeInfo(data) {
    record = await record;
    // console.log(JSON.stringify(data, null, 2));
    record.set(data, async (err) => {
        if (err) {
            console.error("Record set failed with error: ", err);
        }
        const netStats = await si.networkStats("*");
    });
};

/**
 * Specify desired information and get it in interval specified
 * @global sendInterval
 */
function getRuntimeInfo() {
    const desiredInfo = {
        processes: `all, running, blocked, sleeping, unknown, list`, 
        // list: `pid, parentPid, name, 
        //        pcpu, pmem, priority, mem_vsz, 
        //        mem_rss, nice, started, state
        //        tty, user, command, params, path`, 
        // diskLayout: `device, type, name, vendor, size, serialNum, interfaceType`,
        // blockDevices: `name, type, fstype, mount, size, physical, uuid, label, model, serial, removable, protocol`,
        disksIO: `rIO, wIO, tIO, tIO, rIO_sec, wIO_sec, tIO_sec, ms`,
        networkStats: `iface, operstate, rx_bytes, rx_dropped, rx_errors, tx_bytes, tx_dropped, tx_errors, rx_sec, tx_sec  (*)`,
    }
    si.observe(desiredInfo, sendInterval, sendRuntimeInfo);
}

/**
 * Get container-ID from within container.
 * os.hostname() will only show a limited number of chars of the actual container-ID (SHA-256),
 * so the file "/proc/self/cgroup" will be used to determine the whole container-ID.
 */
function getContainerId() {
    let file;
    const filename = "/proc/self/cgroup"
    try {
        file = fs.readFileSync(filename, "utf8");
    } catch (err) {
        // end process with error code
        console.error(`Cannot get hostname/ container-ID from file ${filename}`)
        process.exit(2);
    }
    let hostname = file.match("(?<=\\/docker\\/)\\w{64}");
    return hostname;
}
