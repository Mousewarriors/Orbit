#!/usr/bin/env node
import { runCli } from "../index.js";

/** Executable entry for the `orbit` CLI. */
const exitCode = await runCli(process.argv.slice(2));
process.exitCode = exitCode;
