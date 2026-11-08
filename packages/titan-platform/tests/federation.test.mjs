import assert from "node:assert/strict";
import test from "node:test";
import { validateFederationOffer } from "../.test-dist/federation/contract.js";
const offer = { relationship_id: "rel-1", sender_node_id: "node-a", receiver_node_id: "node-b", company_id: "company-a", purpose: "dispatch", scope: ["job.read"], constitution_version: "titan.constitution.v1", authority_ceiling: 2, privacy_egress_approved: true, expires_at: "2027-01-01T00:00:00.000Z" };
test("accepts a scoped sovereign offer", () => assert.deepEqual(validateFederationOffer(offer, new Date("2026-06-01T00:00:00.000Z")), { allowed: true, relationship_id: "rel-1" }));
test("rejects revoked, expired, cross-node and unapproved offers", () => { assert.equal(validateFederationOffer({ ...offer, revoked_at: "2026-01-01T00:00:00.000Z" }).allowed, false); assert.equal(validateFederationOffer({ ...offer, expires_at: "2025-01-01T00:00:00.000Z" }).allowed, false); assert.equal(validateFederationOffer({ ...offer, receiver_node_id: "node-a" }).allowed, false); assert.equal(validateFederationOffer({ ...offer, privacy_egress_approved: false }).allowed, false); });

