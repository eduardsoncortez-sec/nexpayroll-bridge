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
