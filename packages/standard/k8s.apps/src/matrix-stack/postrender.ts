#!/usr/bin/env node
import { readFileSync } from "node:fs"

const input = readFileSync(0, "utf8")
const normalizedInput = `\n${input.replace(/\r\n/g, "\n")}`
const documents = normalizedInput.split(/\n---\s*\n/).filter(Boolean)
const ingressPattern = /^\s*kind:\s*Ingress\s*(?:#.*)?$/m
const filtered = documents.filter(document => !ingressPattern.test(document))
const output = filtered.filter(document => document.trim().length > 0).join("\n---\n")

process.stdout.write(output.endsWith("\n") ? output : `${output}\n`)
