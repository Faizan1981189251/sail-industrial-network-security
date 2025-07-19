// Initialize notifications
const notyf = new Notyf({
 duration: 3000,
 position: {
 x: 'right',
 y: 'top',
 },
 types: [
 {
 type: 'warning',
 background: '#ffc107',
 icon: {
 className: 'fas fa-exclamation-triangle',
 tagName: 'i',
 color: '#fff'
 }
 },
 {
 type: 'error',
 background: '#dc3545',
 duration: 5000,
 icon: {
 className: 'fas fa-shield-virus',
 tagName: 'i',
 color: '#fff'
 }
 }
 ]
});
$(document).ready(function() {
 // Toggle email alerts input
 $('#emailAlertsSwitch').change(function() {
 if ($(this).is(':checked')) {
 $('#emailSettings').slideDown();
 } else {
 $('#emailSettings').slideUp();
 }
 });
 // Toggle SMS alerts input
 $('#smsAlertsSwitch').change(function() {
 if ($(this).is(':checked')) {
 $('#smsSettings').slideDown();
 } else {
 $('#smsSettings').slideUp();
 }
 });
 // Save alert settings
 $('#saveAlertSettings').click(function() {
 notyf.success('Alert settings saved successfully');
 });
 // File upload handling – now calls AnomalyDetectAPI loop
 $('#logFileUpload').change(async function() {
 if (this.files.length > 0) {
 const file = this.files[0];
 notyf.success(`File "${file.name}" selected for processing`);
 $('#logsProcessedCount').text('Processing…');
 
 // Clear previous charts and visualizations before processing new data
 initializeCharts();
 // Read and parse the CSV file
 Papa.parse(file, {
 header: true,
 complete: async function(results) {
 try {
 // Validate required fields in each row
 const logs = [];
 const errors = [];
 
 results.data.forEach((row, index) => {
 // Validate required fields
 if (!row.timestamp || isNaN(parseFloat(row.timestamp)) && isNaN(new Date(row.timestamp).getTime())) {
 errors.push(`Row ${index+1}: Missing or invalid timestamp`);
 return;
 }
 if (!row.feature1 || isNaN(parseFloat(row.feature1))) {
 errors.push(`Row ${index+1}: Missing or invalid feature1`);
 return;
 }
 if (!row.feature2 || isNaN(parseFloat(row.feature2))) {
 errors.push(`Row ${index+1}: Missing or invalid feature2`);
 return;
 }
 
 // If validation passes, format log for API
 logs.push({
 timestamp: parseFloat(row.timestamp) || Math.floor(new Date(row.timestamp).getTime() / 1000),
 source: row.source || "unknown",
 feature1: parseFloat(row.feature1) || 0,
 feature2: parseFloat(row.feature2) || 0
 // Additional fields can be mapped as needed
 });
 });
 
 // Show validation errors if any
 if (errors.length > 0) {
 const errorMessage = `${errors.length} rows had errors:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...(and more)' : ''}`;
 notyf.error(errorMessage);
 console.error('CSV validation errors:', errors);
 $('#logsProcessedCount').text('0');
 return;
 }
 
 // Filter out any remaining invalid entries
 const validLogs = logs.filter(log => log.timestamp);
 
 if (validLogs.length === 0) {
 notyf.error('No valid logs found in the file');
 $('#logsProcessedCount').text('0');
 return;
 }
 // Store ground truth labels for UI highlighting (if present)
 const groundTruthLabels = {};
 results.data.forEach(row => {
 if (row.label) {
 groundTruthLabels[row.timestamp] = row.label === "1" ||
 row.label.toLowerCase() === "true" ||
 row.label.toLowerCase() === "anomaly";
 }
 });
 // Get model selection from UI
 const model = $('input[name="aiModel"]:checked').attr('id') === 'isolationForest'
 ? 'IsolationForest'
 : ($('input[name="aiModel"]:checked').attr('id') === 'autoencoder'
 ? 'Autoencoder'
 : 'OneClassSvm');
 // Check if model is ready
 if (!window.modelReady) {
 notyf.error('Model is not trained yet. Please train the model first.');
 $('#logsProcessedCount').text('0');
 return;
 }
 
 // Check if automatic calibration is enabled
 let sensitivity = $('#sensitivitySlider').val() / 10;
 
 if ($('#autoCalibrationSwitch').is(':checked')) {
 // Call auto-calibration API
 try {
 const calibrationResponse = await fetch(
 'https://magicloops.dev/api/loop/auto-calibrate-threshold-api/run',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ logs: logs })
 }
 );
 const calibrationResult = await calibrationResponse.json();
 
 if (calibrationResult && calibrationResult.sensitivity) {
 sensitivity = calibrationResult.sensitivity;
 // Update slider to match calibrated value but keep it disabled
 $('#sensitivitySlider').val(sensitivity * 10).prop('disabled', true);
 notyf.success(`Sensitivity auto-calibrated to ${(sensitivity * 100).toFixed(0)}%`);
 }
 } catch (err) {
 console.error("Auto-calibration failed:", err);
 notyf.error("Auto-calibration failed, using manual sensitivity");
 // Re-enable slider if auto-calibration fails
 $('#sensitivitySlider').prop('disabled', false);
 }
 }
 // Call the AnomalyDetectAPI loop
 const response = await fetch(
 'https://magicloops.dev/api/loop/13882515-df46-4936-b161-2c4bb0996ee0/run',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 logs: logs,
 model: model,
 sensitivity: sensitivity
 })
 }
 );
 const result = await response.json();
 
 // Update UI counters
 $('#logsProcessedCount').text(logs.length.toLocaleString());
 $('#anomaliesDetectedCount').text(
 result.anomalies && result.anomalies !== 'none'
 ? result.anomalies.length
 : '0'
 );
 initializeCharts();
 if (result.anomalies && result.anomalies !== 'none' && result.anomalies.length) {
 notyf.error(`${result.anomalies.length} anomalies detected`);
 
 // Create lookup map for anomalies by timestamp
 const anomalyMap = {};
 result.anomalies.forEach(anomaly => {
 anomalyMap[anomaly.timestamp] = anomaly;
 });
 
 // Highlight anomalies in log viewer based on API results
 $('#logViewer').empty();
 logs.forEach(log => {
 const anomaly = anomalyMap[log.timestamp];
 $('#logViewer').append(`
 <div class="log-entry ${anomaly ? 'anomaly' : ''}">
 <span class="text-muted">[${new Date(log.timestamp*1000).toISOString()}]</span>
 ${anomaly ? `<span class="text-danger">[ANOMALY: Score ${anomaly.score.toFixed(2)}]</span> ` : ''}
 Source: ${log.source}, Feature1: ${log.feature1}, Feature2: ${log.feature2}
 ${anomaly ? `<br><small class="text-danger">${anomaly.description}</small>` : ''}
 </div>
 `);
 });
 // If SMS alerts enabled, send each anomaly via AnomalySMS loop
 if ($('#smsAlertsSwitch').is(':checked')) {
 // ... rest of code ...
 }
 } else {
 notyf.success('No anomalies detected');
 // Clear log viewer and show message
 $('#logViewer').empty().append(`
 <div class="log-entry">
 <span class="text-success">No anomalies detected in ${logs.length} records.</span>
 </div>
 `);
 }
 } catch (err) {
 console.error(err);
 notyf.error('Error processing logs');
 $('#logsProcessedCount').text('0');
 $('#anomaliesDetectedCount').text('0');
 }
 },
 error: function(error) {
 console.error("CSV parsing error:", error);
 notyf.error('Error parsing CSV file');
 $('#logsProcessedCount').text('0');
 $('#anomaliesDetectedCount').text('0');
 }
 });
 }
 });
 // Toggle live monitoring
 $('#liveMonitoringSwitch').change(function() {
 if ($(this).is(':checked')) {
 notyf.success('Live monitoring enabled');
 // This would normally start a websocket connection or polling
 } else {
 notyf.info('Live monitoring disabled');
 }
 });
 // Configure sources button
 $('#configureSourcesBtn').click(function() {
 notyf.info('This is a prototype. The configuration panel would appear here.');
 });
 // Reset session button
 $('#resetSession').click(function() {
 if (confirm('Are you sure you want to reset the current session? All unsaved data will be lost.')) {
 // Clear LocalStorage data
 localStorage.removeItem('networkLogs');
 localStorage.removeItem('alertSettings');
 localStorage.removeItem('sessionData');
 
 // Reset UI
 $('#logsProcessedCount').text('0');
 $('#anomaliesDetectedCount').text('0');
 $('#sessionDuration').text('00:00:00');
 
 notyf.success('Session reset successfully');
 
 // Reset charts
 initializeCharts();
 }
 });
 // Generate report button
 $('#generateReportBtn').click(function() {
 const startDate = $('#startDate').val();
 const endDate = $('#endDate').val();
 
 if (!startDate || !endDate) {
 notyf.error('Please select both start and end dates');
 return;
 }
 
 // Display loading state
 $('#reportContainer').html('<div class="text-center"><div class="spinner-border text-primary" role="status"></div><p class="mt-2">Generating report...</p></div>');
 
 // This would normally call an API to generate the report
 setTimeout(() => {
 $('#reportContainer').html('<p class="text-center">This is a prototype. The historical report would be displayed here.</p>');
 }, 2000);
 });
 // Initialize charts on page load
 initializeCharts();
 
 // Update session duration periodically
 let seconds = 0;
 setInterval(function() {
 seconds++;
 const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
 const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
 const secs = (seconds % 60).toString().padStart(2, '0');
 $('#sessionDuration').text(`${hours}:${minutes}:${secs}`);
 }, 1000);
 // Auto-calibration toggle handler
 $('#autoCalibrationSwitch').change(function() {
 if ($(this).is(':checked')) {
 $('#sensitivitySlider').prop('disabled', true);
 notyf.info('Automatic threshold calibration enabled. Upload data to calibrate.');
 } else {
 $('#sensitivitySlider').prop('disabled', false);
 notyf.info('Manual sensitivity control enabled.');
 }
 });
 // Initialize tooltips
 $(function () {
 $('[data-bs-toggle="tooltip"]').tooltip();
 });
 // Theme toggle functionality
 const storedTheme = localStorage.getItem('darkTheme');
 if (storedTheme === 'true') {
 $('body').addClass('dark-theme');
 $('#themeToggleSwitch').prop('checked', true);
 }
 $('#themeToggleSwitch').change(function() {
 if ($(this).is(':checked')) {
 $('body').addClass('dark-theme');
 localStorage.setItem('darkTheme', 'true');
 
 // Update charts with dark theme
 if (timeSeriesChart) {
 timeSeriesChart.updateOptions({
 theme: {
 mode: 'dark'
 },
 grid: {
 borderColor: '#444'
 }
 });
 }
 
 if (performanceChart) {
 performanceChart.updateOptions({
 theme: {
 mode: 'dark'
 }
 });
 }
 } else {
 $('body').removeClass('dark-theme');
 localStorage.setItem('darkTheme', 'false');
 
 // Update charts with light theme
 if (timeSeriesChart) {
 timeSeriesChart.updateOptions({
 theme: {
 mode: 'light'
 },
 grid: {
 borderColor: '#f1f1f1'
 }
 });
 }
 
 if (performanceChart) {
 performanceChart.updateOptions({
 theme: {
 mode: 'light'
 }
 });
 }
 }
 
 // Re-initialize charts to apply theme
 initializeCharts();
 });
 let timeSeriesChart;
 let performanceChart;
 function initializeCharts() {
 // Remove loading overlays
 setTimeout(() => {
 $('.loading-overlay').fadeOut();
 }, 1000);
 
 // Destroy existing chart instances before creating new ones
 if (window.timeSeriesChart) {
 window.timeSeriesChart.destroy();
 document.querySelector('#timeSeriesChart').innerHTML = '';
 }
 
 if (window.performanceChart) {
 window.performanceChart.destroy();
 document.querySelector('#performanceChart').innerHTML = '';
 }
 
 // Clear the heatmap container
 document.getElementById('networkHeatmap').innerHTML = '';
 
 // Set theme for ApexCharts based on current mode
 const isDarkMode = $('body').hasClass('dark-theme');
 const chartTheme = {
 mode: isDarkMode ? 'dark' : 'light'
 };
 
 const timeSeriesOptions = {
 series: [{
 name: 'Anomaly Score',
 data: generateRandomData(30, 0, 1)
 }],
 chart: {
 height: 280,
 type: 'line',
 toolbar: {
 show: false
 },
 animations: {
 enabled: true
 }
 },
 stroke: {
 curve: 'smooth',
 width: 3
 },
 colors: ['#0b3b71'],
 xaxis: {
 categories: generateTimeCategories(30),
 labels: {
 show: true,
 rotate: -45,
 rotateAlways: false
 }
 },
 yaxis: {
 title: {
 text: 'Anomaly Score'
 },
 min: 0,
 max: 1
 },
 markers: {
 size: 4,
 hover: {
 size: 6
 }
 },
 grid: {
 borderColor: isDarkMode ? '#444' : '#f1f1f1'
 },
 theme: chartTheme,
 tooltip: {
 y: {
 formatter: function(val) {
 return val.toFixed(3);
 }
 }
 }
 };
 window.timeSeriesChart = new ApexCharts(document.querySelector("#timeSeriesChart"), timeSeriesOptions);
 window.timeSeriesChart.render();
 // Performance metrics chart
 const performanceOptions = {
 series: [{
 name: 'Precision',
 data: generateRandomData(7, 80, 100)
 }, {
 name: 'Recall',
 data: generateRandomData(7, 75, 95)
 }, {
 name: 'F1 Score',
 data: generateRandomData(7, 70, 90)
 }],
 chart: {
 height: 280,
 type: 'radar',
 toolbar: {
 show: false
 }
 },
 xaxis: {
 categories: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7']
 },
 yaxis: {
 show: false,
 min: 0,
 max: 100
 },
 fill: {
 opacity: 0.3
 },
 markers: {
 size: 3
 },
 stroke: {
 width: 2
 },
 colors: ['#0b3b71', '#3071b9', '#28a745']
 };
 window.performanceChart = new ApexCharts(document.querySelector("#performanceChart"), performanceOptions);
 window.performanceChart.render();
 // Network heatmap (placeholder)
 const heatmapEl = document.getElementById('networkHeatmap');
 heatmapEl.innerHTML = '<div style="width:100%; height:100%; display:flex; justify-content:center; align-items:center; background:#f8f9fa;"><p class="text-center text-muted">This is a prototype.<br>The network heatmap would be displayed here.</p></div>';
 }
 // Helper function to generate random data for charts
 function generateRandomData(count, min, max) {
 const data = [];
 for (let i = 0; i < count; i++) {
 data.push((Math.random() * (max - min) + min).toFixed(3) * 1);
 }
 return data;
 }
 // Helper function to generate time categories
 function generateTimeCategories(count) {
 const now = new Date();
 const categories = [];
 for (let i = count - 1; i >= 0; i--) {
 const date = new Date(now.getTime() - i * 60000);
 categories.push(
 `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
 );
 }
 return categories;
 }
 // Initialize modelReady flag
 window.modelReady = false;
 // Train Model button handler
 $('#trainModelBtn').click(async function() {
 try {
 // Disable button during training
 $(this).prop('disabled', true).html('<span class="spinner-border spinner-border-sm me-1"></span> Training...');
 $('#modelStatus').removeClass('text-danger text-success').addClass('text-warning').text('Training in progress...');
 
 // Get model selection from UI
 const model = $('input[name="aiModel"]:checked').attr('id') === 'isolationForest'
 ? 'IsolationForest'
 : ($('input[name="aiModel"]:checked').attr('id') === 'autoencoder'
 ? 'Autoencoder'
 : 'OneClassSvm');
 
 // Call model training API
 const response = await fetch(
 'https://magicloops.dev/api/loop/model-training-api/run',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 model: model,
 params: {
 sensitivity: $('#sensitivitySlider').val() / 10
 }
 })
 }
 );
 
 const result = await response.json();
 
 // Update UI based on training result
 if (result.success) {
 window.modelReady = true;
 notyf.success(`${model} model trained successfully`);
 $('#modelStatus').removeClass('text-danger text-warning').addClass('text-success').text('Model trained and ready');
 } else {
 throw new Error(result.error || 'Unknown training error');
 }
 } catch (err) {
 console.error("Model training error:", err);
 notyf.error(`Failed to train model: ${err.message}`);
 $('#modelStatus').removeClass('text-success text-warning').addClass('text-danger').text('Model training failed');
 } finally {
 // Re-enable button
 $('#trainModelBtn').prop('disabled', false).html('<i class="fas fa-brain me-1"></i> Train Model');
 }
 });
});
