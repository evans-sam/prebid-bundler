#!/usr/bin/env bun
/**
 * Backward-compatible checkout script.
 * Delegates to the new command module.
 *
 * Usage: bun checkout.ts [options]
 *
 * For full documentation, run: prebid-bundler checkout --help
 */
import { checkout } from "./src/commands/checkout.ts";

await checkout(Bun.argv.slice(2));
