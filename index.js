const { DeepstreamClient } = require("@deepstream/client");
const client = new DeepstreamClient("deepstream:6020");
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
    await login2Deepstream();
    const containers = await client.record.getList(containerListName).whenReady();
    containers.addEntry(`${containerListName}/${containerId}`);
    console.log(`Registration of agent with hostname (= Container-ID): ${containerId} successful.`);
}

/**
 * Unregister this agent
 * @global containerList
 * @global containerId
 */
function unregisterAgent() {
    const containers = client.record.getList(containerListName);
    containers.removeEntry(`${containerListName}/${containerId}`);
}

/**
 * Register exit event handler to make sure agent ALWAYS unregisters itself before it terminates
 */
function registerExitHandler() {
    process.on('exit', exitHandler);
    //catches ctrl+c event
    process.on('SIGINT', exitHandler);
    // catches "kill pid" (for example: nodemon restart)
    process.on('SIGUSR1', exitHandler);
    process.on('SIGUSR2', exitHandler);
    //catches uncaught exceptions
    process.on('uncaughtException', exitHandler);
}

/**
 * Handler method for any (un)expected exit of the program. 
 * Make sure agent ALWAYS unregisters itself.
 */
function exitHandler() {
    unregisterAgent();
}

/**
 * Login to the Deepstream.io server
 */
async function login2Deepstream() {
    await client.login();
    if (client.getConnectionState() !== 'OPEN') {
        console.log("Login failed.");
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
    return await client.record.getRecord(`${containerListName}/${containerId}`).whenReady();
}

async function sendRuntimeInfo(data) {
    record = await record;
    console.log(JSON.stringify(data));
    record.set("runtimeInfo", data, (err) => {
        if (err) {
            console.log("Record set failed with error: ", err);
        }
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
        users: '*',     //'user', 'tty', 'date', 'time', 'ip', 'command'],
        networkStats: `*`,
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
    try {
        file = fs.readFileSync("/proc/self/cgroup", "utf8");
    } catch (err) {
        // end process with error code
        process.exit(2);
    }
    let hostname = file.match("(?<=\\/docker\\/)\\w{64}");
    return hostname;
}
