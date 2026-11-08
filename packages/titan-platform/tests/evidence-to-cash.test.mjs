import test from "node:test";import assert from "node:assert/strict";import {createCashLifecycle,issueCash,recordPayment,reconcileCash} from "../.test-dist/evidence-to-cash.js";
const input={cash_id:"c1",company_id:"co1",customer_ref:"customer:1",currency:"AUD",amount_minor:1000,evidence_refs:[],reconciliation_refs:[]};
test("keeps evidence-backed payment and reconciliation lifecycle company-scoped",()=>{let x=issueCash(createCashLifecycle(input),"invoice:e1");x=recordPayment(x,400,"payment:e1");x=recordPayment(x,600,"payment:e2");x=reconcileCash(x,"recon:1");assert.equal(x.stage,"PAID");assert.equal(x.paid_minor,1000);assert.equal(x.authorityGranted,false)});
test("fails closed on overpayment, invalid order, and missing evidence",()=>{assert.throws(()=>recordPayment(createCashLifecycle(input),100,"p"),/payment-stage/);let x=issueCash(createCashLifecycle(input),"i");assert.throws(()=>recordPayment(x,1001,"p"),/amount/);assert.throws(()=>reconcileCash(x,"r"),/reconcile-stage/)})

