import { createAiJobClient } from "@ankify/api-client";

const client = createAiJobClient((path, init) => fetch(path, init));

export const startAiJob = client.start;
export const getActiveAiJob = client.getActive;
export const waitForAiJob = client.wait;
export const requireSucceededAiJob = client.requireSucceeded;
