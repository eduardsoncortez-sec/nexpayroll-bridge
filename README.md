<div align="center">

# 🌐 NexPayroll Biometric Bridge

### Node.js • IoT • Biometric Attendance • ZKTeco F80 • T800 • Supabase

A lightweight biometric integration service that connects physical
attendance devices to a cloud-based payroll and HRIS environment.

</div>

---

## 📌 Overview

The **NexPayroll Biometric Bridge** is a Node.js service designed to receive,
process, and forward attendance data from biometric devices.

It supports multiple biometric device formats including:

- **ZKTeco F80 / ADMS devices**
- **T800 biometric devices**
- JSON-based attendance payloads
- Tab-separated `ATTLOG` records
- Custom device payload formats

The bridge acts as the communication layer between biometric hardware
and the cloud database.

---

## 🏗️ Architecture

```text
+----------------------+
|   Biometric Device   |
|  F80 / T800 / ZKTeco |
+----------+-----------+
           |
           | HTTP / ADMS Push Data
           v
+----------------------+
| NexPayroll Biometric |
|       Bridge         |
|       Node.js        |
+----------+-----------+
           |
           | Validate / Parse
           | Attendance Data
           v
+----------------------+
|       Supabase       |
|      PostgreSQL      |
+----------+-----------+
           |
           v
+----------------------+
|   Payroll / HRIS     |
| Attendance Workflow  |
+----------------------+

✨ Key Features
🕒 Attendance Processing

Processes attendance records received from biometric devices and
prepares them for storage and payroll workflows.

📡 Device Communication

Supports biometric device communication using HTTP-based push protocols.

🔄 Multiple Data Formats

The bridge can process:

T800 JSON attendance data
T800 custom/form-style payloads
ZKTeco/F80 ATTLOG data
Raw device payloads for troubleshooting
❤️ Device Heartbeat

Device requests can update the latest heartbeat timestamp,
allowing the system to monitor device connectivity.

🧪 Health Check Endpoint

Includes a simple service health endpoint:

/health

Example response:

{
  "status": "ok",
  "uptime": 12345
}
🗄️ Supabase Integration

Attendance and device data are forwarded to Supabase for persistent
storage and integration with the payroll/HRIS application.

🧰 Technology Stack
Technology	Purpose
Node.js	Backend runtime
JavaScript	Application logic
HTTP	Biometric device communication
Supabase	Cloud database integration
PostgreSQL	Persistent data storage
ZKTeco ADMS	Attendance push protocol
📂 Project Structure
nexpayroll-bridge/
│
├── bridge.js
├── package.json
└── README.md
bridge.js

Main biometric bridge service responsible for:

Starting the HTTP server
Receiving biometric requests
Handling device handshakes
Processing attendance records
Parsing multiple biometric formats
Updating device heartbeat data
Sending processed data to Supabase
package.json

Defines the Node.js application and required dependencies.

⚙️ Environment Variables

The bridge uses environment variables for deployment configuration.

PORT=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
COMPANY_ID=
Variables
Variable	Description
PORT	HTTP server port
SUPABASE_URL	Supabase project URL
SUPABASE_SERVICE_ROLE_KEY	Server-side database credential
COMPANY_ID	Company identifier used by the HRIS/payroll system

⚠️ Never commit production credentials or .env files to GitHub.

🔄 How It Works
1. Device connects

The biometric device sends an HTTP request to the bridge.

2. Device identification

The bridge reads information such as the device serial number.

3. Payload detection

The application determines whether the incoming data is:

T800 JSON
T800 Custom Format
ZKTeco ATTLOG
Other / Raw Device Data
4. Data processing

Attendance information such as employee ID and punch time is parsed
and validated.

5. Database storage

Processed records are forwarded to Supabase.

6. HRIS / Payroll processing

Attendance data becomes available to downstream payroll and HRIS workflows.

🔌 Supported Device Workflows
ZKTeco / F80

Supports ADMS-style attendance communication including:

GET Device Handshake
POST Attendance Data
ATTLOG Processing
OPERLOG Acknowledgement
Device Serial Number Detection
T800

Supports multiple T800 payload formats including:

JSON Attendance Records
Custom / Form Payloads
Binary / Latin-1 Payload Handling
Enrollment Data Detection
🔐 Security Considerations

The bridge is designed as a server-side integration service.

Security practices include:

Sensitive Supabase credentials stored as environment variables
No production service-role key should be stored in source code
Server-side database access
Raw device payload handling for controlled troubleshooting
Separation between device communication and application UI

For production deployments, additional controls should be considered:

Firewall and network restrictions
HTTPS / reverse proxy
Restricted device access
Secret rotation
Server monitoring
Logging and alerting
Rate limiting where applicable
🚀 Running Locally

Install dependencies:

npm install

Configure the required environment variables.

Then start the bridge:

npm start

By default, the application can run on:

PORT=9091
☁️ Deployment

Because biometric devices continuously communicate with the bridge,
the service should run on an always-on server environment.

Suitable environments include:

VPS
Docker-based hosting
Coolify
Railway
Other persistent Node.js hosting environments

A purely static or short-lived serverless environment is generally
not ideal for this type of persistent device integration.

🧩 Use Cases

This bridge can support:

Employee biometric attendance
Payroll attendance integration
Multi-device attendance systems
HRIS biometric integration
Branch attendance monitoring
Device connectivity monitoring
IoT-to-cloud data synchronization
👨‍💻 Project Role

My work on this integration involved areas such as:

Biometric device communication
Attendance push-data processing
T800 and ZKTeco F80 integration
Device protocol analysis
API and database integration
Supabase connectivity
Device heartbeat handling
Attendance workflow troubleshooting
Production deployment support
🎯 Project Goal

The goal of the project is to provide a reliable communication layer between
physical biometric devices and cloud-based HRIS/payroll systems.

Biometric Hardware
        ↓
Integration Bridge
        ↓
Cloud Database
        ↓
HRIS / Payroll
<div align="center">
🌐 Bridging Physical Devices with Cloud-Based Business Systems

IoT • Backend Development • Biometric Integration • Cloud

</div> ```
