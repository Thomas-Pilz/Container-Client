const { DeepstreamClient } = require("@deepstream/client");
const client = new DeepstreamClient("localhost:6020");
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
const containerList = "containerList";  // name of the "registry" (list of registerd containers)
const sendInterval = 1000;              // interval for collecting and storing data

// Required to register (and unregister) agent. MUST be executed first.
registerExitHandler();
registerAgent();

login2Deepstream();
// create record to save data in
const record = createRecord();
getRuntimeInfo();

/**
 * Register this agent with its container ID
 * @global containerList
 * @global containerId
 */
function registerAgent() {
    const containers = client.record.getList(containerList);
    containers.addEntry(`${containerList}/${containerId}`);
    console.log(`Registration of agent with hostname (= Container-ID): ${containerId} successful.`)
}

/**
 * Unregister this agent
 * @global containerList
 * @global containerId
 */
function unregisterAgent() {
    const containers = client.record.getList(containerList);
    containers.removeEntry(`${containerList}/${containerId}`);
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
async function login2Deepstream(){
    login = await client.login();
    if(!login.success){
        console.log("Login failed.");
        process.exit(1);
    }
    console.log(`Login successful.`);
    registerAgent();
}

/**
 * Create a record within deepstream.io to store the container runtime information
 */
async function createRecord(){
    return await client.record.getRecord(`${containerList}/${containerId}`).whenReady();
}

function sendRuntimeInfo(data) {
    record.set(`${containerList}/${containerId}`, data, (err) => {
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
        processes: `all, running, blocked, sleeping, unknown, 
                    list.pid, list.parent.parentPid, list.name, 
                    list.pcpu, list.pmem, list.priority, list.mem_vsz, 
                    list.mem_rss, list.nice, list.started, list.state
                    list.tty, list.user, list.command, list.params, list.path`,
        diskLayout: `device, type, name, vendor, size, serialNum, interfaceType`,
        blockDevices: `name, type, fstype, mount, size, physical, uuid, label, model, serial, removable, protocol`,
        disksIO: `rIO, wIO, tIO, tIO, rIO_sec, wIO_sec, tIO_sec, ms`
    }
    si.observe(desiredInfo, sendInterval, sendRuntimeInfo);
}

/**
 * Get container-ID from within container.
 * os.hostname() will only show a limited number of chars of the actual container-ID (SHA-256),
 * so the file "/proc/self/cgroup" will be used to determine the whole container-ID.
 * @global containerId 
 */
function getContainerId() {
    // fs.readFile("/proc/self/cgroup", "utf8", (err, data) => {
    //     if(err){
    //         // end process with error code
    //         process.resourceUsage()
    //         process.exit(2);
    //     }
    //     else{
    //         data.match()
    //     }
    // });
    return os.hostname();
}
