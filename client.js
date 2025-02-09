let peerConnection = null; // Make sure this is at the top level

// Add these variables at the top of your file
let statsChart = null;
let statsInterval = null;
let isStatsVisible = false;

document.addEventListener('DOMContentLoaded', () => {
    const statsButton = document.getElementById('statsButton');
    const statsOverlay = document.getElementById('stats-overlay');

    statsButton.addEventListener('click', () => {
        console.log('Stats button clicked, peerConnection:', peerConnection);
        isStatsVisible = !isStatsVisible;
        statsOverlay.style.display = isStatsVisible ? 'block' : 'none';
        statsButton.classList.toggle('active');
        
        if (isStatsVisible && peerConnection) {
            if (!statsChart) {
                initializeStatsGraph();
            }
            // Start stats collection
            statsInterval = setInterval(() => {
                updateStats(peerConnection);
            }, 1000);
        } else {
            // Stop stats collection
            if (statsInterval) {
                clearInterval(statsInterval);
                statsInterval = null;
            }
        }
    });
});

// In your createPeerConnection function, store the connection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    // ...existing code...
}

// Update your stopConnection function
function stopConnection() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
    
    if (statsChart) {
        statsChart.destroy();
        statsChart = null;
    }
    
    isStatsVisible = false;
    document.getElementById('stats-overlay').style.display = 'none';
    document.getElementById('statsButton').classList.remove('active');
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    // ...existing code...
}

// ...existing code...

const maxDataPoints = 50;
const statsData = {
    videoBitrate: Array(maxDataPoints).fill(0),
    frameRate: Array(maxDataPoints).fill(0),
    packetsLost: Array(maxDataPoints).fill(0)
};

function initializeStatsGraph() {
    const ctx = document.getElementById('statsGraph').getContext('2d');
    statsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(maxDataPoints).fill(''),
            datasets: [{
                label: 'Bitrate (kbps)',
                data: statsData.videoBitrate,
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.4
            }, {
                label: 'FPS',
                data: statsData.frameRate,
                borderColor: 'rgb(255, 99, 132)',
                tension: 0.4
            }, {
                label: 'Packets Lost',
                data: statsData.packetsLost,
                borderColor: 'rgb(255, 205, 86)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                },
                x: {
                    display: false
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                }
            }
        }
    });
}

let lastBytesSent = 0;
let lastTimestamp = 0;

async function updateStats(peerConnection) {
    if (!peerConnection) return;
    
    const stats = await peerConnection.getStats();
    let videoStats = null;
    let currentBytesSent = 0;
    let currentTimestamp = 0;

    stats.forEach(report => {
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
            videoStats = report;
            currentBytesSent = report.bytesSent;
            currentTimestamp = report.timestamp;
        }
    });

    if (videoStats && lastBytesSent > 0) {
        // Calculate bitrate
        const bytesPerSecond = (currentBytesSent - lastBytesSent) * 8 / (currentTimestamp - lastTimestamp) * 1000;
        const kbps = Math.round(bytesPerSecond / 1024);

        // Update data arrays
        statsData.videoBitrate.push(kbps);
        statsData.videoBitrate.shift();
        
        statsData.frameRate.push(videoStats.framesPerSecond || 0);
        statsData.frameRate.shift();
        
        statsData.packetsLost.push(videoStats.packetsLost || 0);
        statsData.packetsLost.shift();

        // Update chart
        statsChart.update('none');
    }

    lastBytesSent = currentBytesSent;
    lastTimestamp = currentTimestamp;
}

// Modify your existing initializePeerConnection function
function initializePeerConnection() {
    // ...existing code...
    
    // Remove the automatic stats initialization
    // The stats will now only initialize when the button is clicked
    
    // ...existing code...
}
