// Import required node modules
const scheduler = require("node-schedule");
const nodemailer = require("nodemailer");
const { ethers } = require("ethers");
const figlet = require("figlet");
const ABI = require("./abi");
require("dotenv").config();
const fs = require("fs");

// Import the environment variables
const CONTRACT = process.env.CONTRACT_ADR;
const RPC_URL = process.env.BSC_RPC;

// Storage obj
var report = [];
var presale = {
  startDate: "",
};

// Main Function
const main = async () => {
  let presaleExists = false;
  try {
    // check if restake file exists
    if (!fs.existsSync("./presale.json")) await storedData();
    // get stored values from file
    const storedData = JSON.parse(fs.readFileSync("./presale.json"));
    // not first launch, check data
    if ("startDate" in storedData) {
      const startDate = new Date(storedData.startDate);
      // restore preSale schedule
      scheduler.scheduleJob(startDate, presaleSnipe);
      console.log("Restored Presale: " + startDate);
      presaleExists = true;
    }
  } catch (error) {
    console.error(error);
  }
  // first launch
  if (!presaleExists) {
    const start = await presaleStartDate(2);
    scheduleNext(presaleSnipe, start, 8);
  }
};

// Import wallet detail
const initWallets = (n) => {
  let wallets = [];
  for (let i = 1; i <= n; i++) {
    let wallet = {
      address: process.env["ADR_" + i],
      key: process.env["PVK_" + i],
      index: i,
      ref: "",
    };

    // circular referral system
    if (i === 1) wallet.ref = process.env["ADR_" + n];
    else wallet.ref = process.env["ADR_" + (i - 1)];

    wallets.push(wallet);
  }
  return wallets;
};

// Ethers connect on each wallet
const connect = async (wallet) => {
  let connection = {};

  // Add connection properties
  connection.provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  connection.wallet = new ethers.Wallet(wallet.key, connection.provider);
  connection.contract = new ethers.Contract(CONTRACT, ABI, connection.wallet);

  // connection established
  await connection.provider.getBalance(wallet.address);
  return connection;
};

const presaleSnipe = async () => {
  // start function
  console.log("\n");
  console.log(
    figlet.textSync("PresaleSnipe", {
      font: "Standard",
      horizontalLayout: "default",
      verticalLayout: "default",
      width: 80,
      whitespaceBreak: true,
    })
  );

  // get wallet detail from .env
  const wallets = initWallets(5);
  report.push("PRESALE STARTED!");
  presale.startDate = new Date();

  // loop through for each wallet
  for (const wallet of wallets) {
    try {
      snipeWallet(wallet, wallet.ref, 1);
    } catch (error) {
      console.error(error);
    }
  }

  // send status update report
  report.push({ ...presale });
  sendReport(report);
};

// Individual Wallet Snipe Function
const snipeWallet = async (wallet, ref, tries) => {
  try {
    // limit to maximum 5 tries
    if (tries > 5) return false;
    console.log(`Try #${tries}...`);
    console.log(`Wallet ${wallet["index"]}`);

    // connection using the current wallet
    const connection = await connect(wallet);
    const mask = wallet.address.slice(0, 5) + "..." + wallet.address.slice(-6);
    let presaleStarted = false;

    while (!presaleStarted) {
      // keep checking if Round 2 of presale is open
      presaleStarted = await connection.contract.start();
      await delay(3); // 3 sec blocktime of bsc
    }

    // need to approve BUSD spend beforehand
    // call the buyPresale2() and await results
    const amt = ethers.utils.parseEther("100");
    const result = await connection.contract.buyPresale2(amt, ref);
    const receipt = await result.wait();

    // succeeded
    if (receipt) {
      // get the remaining balance of the current wallet
      const u = await connection.provider.getBalance(wallet.address);
      console.log(`Wallet${wallet["index"]}: success`);
      const balance = ethers.utils.formatEther(u);
      console.log(`Balance: ${balance} BNB`);

      // successful
      const success = {
        index: wallet.index,
        wallet: mask,
        balance: balance,
        minted: true,
      };

      report.push(success);
      sendReport(report);
    }
  } catch (error) {
    console.log("Attempt Failed!");
    console.log("retrying...");
    console.error(error);

    // fail, increment try count and retry again
    return await snipeWallet(wallet, ref, ++tries);
  }
};

// Time Delay Function
const delay = (seconds) => {
  const ms = seconds * 1000;
  console.log(`delay(${ms})`);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// Job Scheduler Function
const scheduleNext = async (func, nextDate, t) => {
  // set next job to execute with delay time
  nextDate.setSeconds(nextDate.getSeconds() + t);
  presale.startDate = nextDate.toString();
  console.log("Next: ", nextDate);

  // schedule next restake
  scheduler.scheduleJob(nextDate, func);
  storeData();
  return;
};

// Data Storage Function
const storeData = async () => {
  const data = JSON.stringify(presale);
  fs.writeFile("./presale.json", data, (err) => {
    if (err) {
      console.error(err);
    } else {
      console.log("Data stored:", presale);
    }
  });
};

// Current Date Function
const todayDate = () => {
  const today = new Date();
  return today.toLocaleString("en-GB", { timeZone: "Asia/Singapore" });
};

// Presale Dat Function
const presaleStartDate = async (index) => {
  try {
    // hard coded start time, not onchain
    const time = Math.max(0, 1691935261);
    const startDate = new Date(time * 1000);
    console.log(
      startDate.toLocaleString("en-GB", { timeZone: "Asia/Singapore" })
    );

    return startDate;
  } catch (error) {
    console.error(error);
    return false;
  }
};

// Send Report Function
const sendReport = async (report) => {
  // get the formatted date
  const today = todayDate();
  console.log(report);

  // configure email server
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_ADDR,
      pass: process.env.EMAIL_PW,
    },
  });

  // setup mail params
  const mailOptions = {
    from: process.env.EMAIL_ADDR,
    to: process.env.RECIPIENT,
    subject: "Presale Report: " + today,
    text: JSON.stringify(report, null, 2),
  };

  // send the email message
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Email sent: " + info.response);
    }
  });
};

main();
