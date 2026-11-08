import test from "node:test";import assert from "node:assert/strict";import {createQuoteConversion,transitionQuote,convertQuote} from "../.test-dist/quote-conversion.js";
const input={quote_id:"q1",company_id:"co1",customer_ref:"customer:1",evidence_refs:[]};
test("requires acceptance evidence before governed quote conversion",()=>{let x=createQuoteConversion(input);x=transitionQuote(x,"SENT");assert.throws(()=>transitionQuote(x,"ACCEPTED"),/evidence/);x=transitionQuote(x,"ACCEPTED","accept:1");x=convertQuote(x,"job:1","convert:1");assert.equal(x.stage,"CONVERTED");assert.equal(x.authorityGranted,false)});
test("rejects invalid quote transitions",()=>{assert.throws(()=>convertQuote(createQuoteConversion(input),"j","e"),/stage/);assert.throws(()=>transitionQuote(createQuoteConversion(input),"CONVERTED"),/transition/)})

