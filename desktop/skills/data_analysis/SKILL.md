---
name: data_analysis
description: Perform deep statistical analysis, anomaly detection, metric aggregation, and executive data summaries on CSV, Excel, and JSON datasets. Use this whenever the user asks to analyze data, inspect trends, calculate metrics, summarize statistics, or uncover insights from numbers or spreadsheets.
triggers: ["analyze", "data", "metrics", "trends", "statistics", "dataset", "insights", "distribution"]
---
# Data Analysis & Intelligence Guidelines

## 1. Data Ingestion & Pre-Flight Audit
- Always inspect the structure first using `analyze_spreadsheet` or `read_file`.
- Check row count, column data types, missing/null values, and unexpected outliers.
- State clearly what dataset was loaded, how many rows/columns were analyzed, and note any data quality issues detected.

## 2. Statistical Rigor
- When calculating summary statistics:
  - Provide Mean, Median, Min, Max, and Standard Deviation where meaningful.
  - Highlight top performers, low performers, and percentage contributions to the total.
  - Never invent or hallucinate metrics; every number must be directly computed from the data.

## 3. Executive Output Format
- Present findings using a structured 3-part framework:
  1. **Executive Key Findings**: 3–5 bullet points summarizing the most critical takeaways.
  2. **Metrics Breakdown Table**: A clean markdown table comparing categories, dates, or segments.
  3. **Actionable Recommendations**: 2–3 concrete business or operational next steps based on the findings.
- If saving a summary report, save as an executive `.docx` or formatted `.xlsx` with dark navy headers (`#1B365D`) on the user's Desktop (`~/Desktop`).
