/**
 * Sample workbook for testing: 5 dummy records in the full column layout (19 original + engineering-feedback columns), each with a different combination of
 * Image / Word / Excel / web-link attachments. The files live in attachments/samples/ (resolved through ATTACHMENT_ROOT),
 * so the workbook can be uploaded on its own. Served by /api/template?sample=1 (add &dup=1 for a 6th, duplicate row).
 */
import { buildTemplate, exampleRow } from "./excel";
import type { DefectRow } from "./schema";

const S = "attachments/samples/";
const base = (o: Partial<DefectRow>): DefectRow => ({
  ...exampleRow(), Customer: "Acme Corp", ProjectKey: process.env.SAMPLE_PROJECT_KEY || "JAIT", ProjectName: "Jira Automate Ignite Testing", ProjectType: "software",
  Lead: "Alex Morgan", AssigneeEmail: process.env.SAMPLE_ASSIGNEE_EMAIL || "alex.morgan@acme-demo.com", ReporterEmail: process.env.SAMPLE_REPORTER_EMAIL || "sam.lee@acme-demo.com",
  AutomatedFix: "No", FixRuleId: "", RootCause: "", Impact: "", Prerequisites: "", DependentSources: "", ...o,
});

export const sampleRows = (): DefectRow[] => [
  base({ Customer: "Acme Corp", IssueType: "Bug", Priority: "High Attention",
    AutomatedFix: "Yes", FixRuleId: "FIX-CAST-007", RootCause: "Automated fix kept the old 18-character MATNR type after the Table-to-CDS conversion.", Impact: "Dump in every call of MAP_STRUCTURE for materials longer than 18 characters.", Prerequisites: "Transport K9X0037 imported; CDS structure ZS_VBAP_NEW active.", DependentSources: "Table VBAP, CDS structure ZS_VBAP_NEW, class ZCL_CC_FIELD_MAPPER.",
    Summary: "ABAP dump ASSIGN_CASTING_ILLEGAL_CAST in ZCL_CC_FIELD_MAPPER=>MAP_STRUCTURE",
    Description: "Runtime error ASSIGN_CASTING_ILLEGAL_CAST when assigning ls_vbap to field-symbol <ls_target> typed with the new CDS structure. Field lengths differ after Table-to-CDS conversion (MATNR 18 -> 40).",
    AttachmentPaths: `${S}st22_cast_dump.png|${S}analysis_cast_error.docx` }),                       // Image + Word
  base({ Customer: "Acme Corp", IssueType: "Bug", Priority: "High",
    AutomatedFix: "Yes", FixRuleId: "FIX-VBAP-014", RootCause: "Automated fix joined VBAP to schedule lines without restricting on ETENR.", Impact: "Item counts double for orders with schedule lines (about 4% of sales orders).", Prerequisites: "Transport K9X0042 imported; CDS view ZI_SalesDocItem active.", DependentSources: "Tables VBAP and VBEP; CDS view I_SalesDocumentItem.",
    Summary: "CDS view ZI_SalesDocItem returns duplicate rows after VBAP replacement",
    Description: "After replacing direct SELECT on VBAP with CDS view ZI_SalesDocItem the item count doubles for orders with multiple schedule lines (VBEP). Join cardinality on _ScheduleLine is MANY instead of ONE.",
    AttachmentPaths: `${S}cds_duplicate_rows.png|${S}cds_row_counts.xlsx` }),                        // Image + Excel
  base({ Customer: "Contoso Mining", IssueType: "Task", Priority: "Medium",
    AutomatedFix: "Yes", FixRuleId: "FIX-CFL-003", RootCause: "Business context for the custom field was not added by the automated fix.", Impact: "Custom field stays empty in reports for goods receipts.",   // Prerequisites and Dependent data sources left empty on purpose: approval is blocked until they are filled in
    Summary: "CFL: custom field ZZ_BATCH_ORIGIN not propagated from goods receipt to MATDOC",
    Description: "Field created in Custom Fields app for Material Document Item. Value is entered via Post Goods Receipt but MATDOC.ZZ_BATCH_ORIGIN stays initial. Check propagation for the business context.",
    AttachmentPaths: `${S}cfl_field_missing.png|${S}cfl_propagation_notes.docx|${S}mrp_type_comparison.xlsx` }), // Image + Word + Excel
  base({ Customer: "Contoso Mining", IssueType: "Bug", Priority: "Low",
    Summary: "AMF syntax failure: missing period after DEFINE ROLE in ZAMF_AUTH_SALES",
    Description: "Activation fails: 'The statement DEFINE ROLE must end with a period' at line 17 of ZAMF_AUTH_SALES. Introduced by the automated formatter in ADT.",
    AttachmentPaths: `${S}st22_cast_dump.png|https://help.sap.com/` }),         // Image + web link
  base({ Customer: "Northwind", IssueType: "Story", Priority: "Medium",
    AutomatedFix: "Yes", FixRuleId: "FIX-CAST-007", RootCause: "Same type-conversion rule as FIX-CAST-007: MARC fields were converted but the association was not.", Impact: "MRP type blank for plants 1010 and 1020.", Prerequisites: "Transport K9X0037 imported.", DependentSources: "Tables MARA and MARC; CDS view I_Product.",
    Summary: "Table-to-CDS: MARA/MARC join replaced by I_Product loses plant-specific MRP type",
    Description: "ZMM_MRP_OVERVIEW previously joined MARA and MARC. After moving to CDS I_Product with association _ProductPlant the MRP type (DISMM) is blank for plants 1010 and 1020.",
    AttachmentPaths: `${S}mrp_type_comparison.xlsx|${S}analysis_cast_error.docx` }),                   // Excel + Word
];

export async function buildSampleWorkbook(withDuplicate = false): Promise<Buffer> {
  const rows = sampleRows();
  if (withDuplicate) rows.push({ ...rows[1], Summary: "CDS view  ZI_SalesDocItem returns DUPLICATE rows after VBAP replacement", AttachmentPaths: "" });
  return buildTemplate({ sample: rows });
}
