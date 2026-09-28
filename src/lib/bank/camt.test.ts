/**
 * ⚠️⚠️ A CAMT statement, read into movements (I13): the shapes Italian banks actually send.
 */
import { describe, expect, it } from "vitest";

import { looksLikeCamt, parseCamt } from "./camt";
import { parseXml } from "./xml-lite";

const v2 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>STMT-1</MsgId></GrpHdr>
    <Stmt>
      <Id>1</Id>
      <Acct><Id><IBAN>IT60X0542811101000000123456</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry>
        <Amt Ccy="EUR">1220.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-09-15</Dt></BookgDt>
        <ValDt><Dt>2026-09-16</Dt></ValDt>
        <AcctSvcrRef>CRO-0001</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
          <RltdPties>
            <Dbtr><Nm>Ristorante Il Glicine S.r.l.</Nm></Dbtr>
            <DbtrAcct><Id><IBAN>IT02L1234512345123456789012</IBAN></Id></DbtrAcct>
          </RltdPties>
          <RmtInf><Ustrd>Saldo FT 12/2026 &amp; interessi</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">35.50</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-09-15</Dt></BookgDt>
        <AddtlNtryInf>Commissioni tenuta conto</AddtlNtryInf>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">99.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>PDNG</Sts>
        <BookgDt><Dt>2026-09-15</Dt></BookgDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

// Version 8 on: statuses are coded, parties are wrapped in Pty, and prefixes are allowed.
const v8batch = `<?xml version="1.0"?>
<c:Document xmlns:c="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <c:BkToCstmrStmt><c:Stmt>
    <c:Acct><c:Id><c:IBAN>IT60X0542811101000000123456</c:IBAN></c:Id></c:Acct>
    <c:Ntry>
      <c:Amt Ccy="EUR">300.00</c:Amt>
      <c:CdtDbtInd>CRDT</c:CdtDbtInd>
      <c:Sts><c:Cd>BOOK</c:Cd></c:Sts>
      <c:BookgDt><c:DtTm>2026-09-20T09:12:00</c:DtTm></c:BookgDt>
      <c:AcctSvcrRef>BATCH-9</c:AcctSvcrRef>
      <c:NtryDtls>
        <c:Btch><c:NbOfTxs>2</c:NbOfTxs></c:Btch>
        <c:TxDtls>
          <c:AmtDtls><c:TxAmt><c:Amt Ccy="EUR">100.00</c:Amt></c:TxAmt></c:AmtDtls>
          <c:RltdPties><c:Dbtr><c:Pty><c:Nm>Anna Greco</c:Nm></c:Pty></c:Dbtr></c:RltdPties>
          <c:RmtInf><c:Strd><c:CdtrRefInf><c:Ref>RF18 000 0000 0000 0000 0012</c:Ref></c:CdtrRefInf></c:Strd></c:RmtInf>
        </c:TxDtls>
        <c:TxDtls>
          <c:AmtDtls><c:TxAmt><c:Amt Ccy="EUR">200.00</c:Amt></c:TxAmt></c:AmtDtls>
          <c:RltdPties><c:Dbtr><c:Pty><c:Nm>Bruno Neri</c:Nm></c:Pty></c:Dbtr></c:RltdPties>
          <c:RmtInf><c:Ustrd>fatt. n. 7</c:Ustrd></c:RmtInf>
        </c:TxDtls>
      </c:NtryDtls>
    </c:Ntry>
  </c:Stmt></c:BkToCstmrStmt>
</c:Document>`;

describe("⚠️⚠️ reading a camt.053", () => {
  it("reads booked credits and debits, the payer, the description and the bank's reference", () => {
    expect(looksLikeCamt(v2)).toBe(true);
    const s = parseCamt(v2);
    expect(s.accountIban).toBe("IT60X0542811101000000123456");
    expect(s.movements).toEqual([
      {
        bookedOn: "2026-09-15",
        valueOn: "2026-09-16",
        amount: 1220,
        currency: "EUR",
        counterpartyName: "Ristorante Il Glicine S.r.l.",
        counterpartyIban: "IT02L1234512345123456789012",
        remittance: "Saldo FT 12/2026 & interessi",
        // "NOTPROVIDED" is not a reference: the entry's own is used.
        bankReference: "CRO-0001",
      },
      {
        bookedOn: "2026-09-15",
        valueOn: null,
        amount: -35.5,
        currency: "EUR",
        counterpartyName: null,
        counterpartyIban: null,
        remittance: "Commissioni tenuta conto",
        bankReference: null,
      },
    ]);
  });

  it("⚠️ leaves out what is not booked: a pending entry may never happen", () => {
    expect(parseCamt(v2).skipped).toEqual({ pending: 1, unreadable: 0 });
  });

  it("⚠️⚠️ splits a batch into its payments when their amounts add up, with their own payers", () => {
    const s = parseCamt(v8batch);
    expect(s.movements.map((m) => [m.amount, m.counterpartyName, m.bookedOn, m.bankReference])).toEqual([
      [100, "Anna Greco", "2026-09-20", "BATCH-9"],
      [200, "Bruno Neri", "2026-09-20", "BATCH-9/2"],
    ]);
    expect(s.movements[1].remittance).toBe("fatt. n. 7");
  });

  it("⚠️ keeps a batch whole when its details do not add up: a split that does not is a guess", () => {
    const s = parseCamt(v8batch.replace(">200.00<", ">150.00<"));
    expect(s.movements.map((m) => m.amount)).toEqual([300]);
  });

  it("refuses a file with no statement in it", () => {
    expect(() => parseCamt("<Document><Other/></Document>")).toThrow();
  });
});

describe("the XML reader", () => {
  it("reads entities, CDATA and attributes with '>' in them, and says where markup does not close", () => {
    const n = parseXml(`<a x="1>2"><b><![CDATA[<raw>]]> &#233;&#x20AC;</b></a>`);
    expect(n.attrs.x).toBe("1>2");
    expect(n.children[0].text).toBe("<raw> é€");
    expect(() => parseXml("<a><b></a>")).toThrow();
    expect(() => parseXml("<a>")).toThrow();
  });
});
