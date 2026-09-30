import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { reportType = "operator_summary", format = "csv" } = body;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (format === "csv") {
      let csvContent = "";
      let filename = `GeoForest_Report_${reportType}_${timestamp}.csv`;

      if (reportType === "plots_compliance") {
        csvContent = [
          "ID,Reference,Name,Commodity,Country,Area_Ha,Vertex_Count,Status,Risk_Level,Loss_Year,Confidence_Score",
          "plot-ci-001,PAR-CI-DIV-01,Parcelle Cacao Divo Est #01,cocoa,CI,14.50,5,COMPLIANT,LOW,,0.96",
          "plot-ci-002,PAR-CI-DIV-02,Parcelle Cacao Divo Sud #02,cocoa,CI,8.20,6,COMPLIANT,LOW,,0.94",
          "plot-br-002,PAR-BR-PARA-04,Fazenda Santa Maria Lote 04,soya,BR,142.30,8,NON_COMPLIANT,CRITICAL,2022,0.98",
          "plot-id-003,PAR-ID-RIAU-03,Perkebunan Sawit Riau Block B,palm_oil,ID,68.00,12,WARNING,STANDARD,,0.91",
        ].join("\n");
      } else if (reportType === "suppliers_traceability") {
        csvContent = [
          "ID,Name,EORI,Country,Commodity,Plots_Count,Completeness_Pct,Risk_Level,Status",
          "sup-ci-001,Cooperative Cacaoyere de Divo,CI123456789012,CI,cocoa,14,100,LOW,ACTIVE",
          "sup-br-002,AgroPecuaria do Para Ltda,BR987654321000,BR,soya,6,65,CRITICAL,ACTIVE",
          "sup-id-003,PT Sumatra Agro Palm,ID554433221100,ID,palm_oil,18,85,STANDARD,ACTIVE",
          "sup-vn-004,Dak Lak Robusta Alliance,VN998877665544,VN,coffee,9,95,LOW,ACTIVE",
        ].join("\n");
      } else {
        // default operator summary
        csvContent = [
          "Report_Type,Operator,EORI,Total_DDR,Declared_TRACES,Compliant_Plots_Pct,Export_Timestamp",
          `Global_EUDR_Operator_Summary,Chocolaterie Europeenne SAS,FR12345678901234,4,1,92%,${new Date().toISOString()}`,
        ].join("\n");
      }

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // JSON format
    return NextResponse.json({
      reportType,
      exportedAt: new Date().toISOString(),
      operator: { name: "Chocolaterie Européenne SAS", eori: "FR12345678901234" },
      status: "SUCCESS",
    });
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la génération du rapport" }, { status: 500 });
  }
}
