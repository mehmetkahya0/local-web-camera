const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        transports: ['websocket', 'polling'],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});
const fs = require('fs');
const path = require('path');
const os = require('os');
const port = 8080;  // Changed port to 8080

// Improved IP detection for macOS
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    // Collect all IPv4 addresses
    Object.keys(interfaces).forEach((name) => {
        interfaces[name].forEach((net) => {
            // Skip internal (i.e. 127.0.0.1) and non-ipv4 addresses
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`Found IP on ${name}:`, net.address);
                addresses.push(net.address);
            }
        });
    });

    // Return first non-internal IPv4 address or localhost as fallback
    return addresses.length > 0 ? addresses[0] : '127.0.0.1';
}

const localIP = getLocalIP();
console.log('Using IP:', localIP);

app.use(express.static(__dirname));

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Make IP address available to client
app.get('/config', (req, res) => {
    res.json({ serverIP: localIP });
});

// Serve index.html for all routes to handle client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = new Map();

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', (roomId) => {
        // Create room if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
        }

        const room = rooms.get(roomId);
        room.add(socket.id);
        socket.join(roomId);
        
        // Notify other users in the room
        socket.to(roomId).emit('user-connected', socket.id);
        
        console.log(`User ${socket.id} joined room ${roomId}`);
    });

    socket.on('offer', (offer, roomId) => {
        console.log(`Offer received from ${socket.id} for room ${roomId}`);
        socket.to(roomId).emit('offer', offer);
    });

    socket.on('answer', (answer, roomId) => {
        console.log(`Answer received from ${socket.id} for room ${roomId}`);
        socket.to(roomId).emit('answer', answer);
    });

    socket.on('ice-candidate', (candidate, roomId) => {
        console.log(`ICE candidate from ${socket.id} for room ${roomId}`);
        socket.to(roomId).emit('ice-candidate', candidate);
    });

    // list of all users in the room
    socket.on('list-users', (roomId) => {
        const room = rooms.get(roomId);
        const users = [];
        if (room) {
            room.forEach(user => {
                users.push(user);
            });
        }
        socket.emit('list-users', users);
    });

    socket.on('console-command', (command) => {
        switch(command) {
            case 'people':
                let response = '\n=== Current Rooms and Users ===\n';
                if (rooms.size === 0) {
                    response += 'No active rooms';
                } else {
                    rooms.forEach((users, roomId) => {
                        response += `\nRoom ${roomId}:\n`;
                        response += `Users: ${Array.from(users)}\n`;
                        response += `Total users in room: ${users.size}\n`;
                    });
                    response += `\nTotal rooms: ${rooms.size}\n`;
                    response += `Total users: ${Array.from(rooms.values()).reduce((acc, room) => acc + room.size, 0)}`;
                }
                socket.emit('console-response', response);
                break;

            case 'clear':
                const totalRooms = rooms.size;
                const totalUsers = Array.from(rooms.values()).reduce((acc, room) => acc + room.size, 0);
                
                rooms.forEach((users, roomId) => {
                    io.to(roomId).emit('force-disconnect', 'Server clearing all rooms');
                });
                
                rooms.clear();
                socket.emit('console-response', `Cleared ${totalRooms} rooms and disconnected ${totalUsers} users`);
                break;
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        // Clean up rooms when users disconnect
        rooms.forEach((users, roomId) => {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                if (users.size === 0) {
                    rooms.delete(roomId);
                }
            }
        });
        console.log('User disconnected:', socket.id);
    });

    socket.on('force-disconnect', () => {
        socket.disconnect(true);
    });
});

// Console commands for server management
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

readline.on('line', (input) => {
    switch(input.toLowerCase()) {
        case 'people':
            console.log('\n=== Current Rooms and Users ===');
            if (rooms.size === 0) {
                console.log('No active rooms');
            } else {
                rooms.forEach((users, roomId) => {
                    console.log(`\nRoom ${roomId}:`);
                    console.log('Users:', Array.from(users));
                    console.log('Total users in room:', users.size);
                });
                console.log('\nTotal rooms:', rooms.size);
                console.log('Total users:', Array.from(rooms.values()).reduce((acc, room) => acc + room.size, 0));
            }
            break;

        case 'clear':
            const totalRooms = rooms.size;
            const totalUsers = Array.from(rooms.values()).reduce((acc, room) => acc + room.size, 0);
            
            // Notify all users in all rooms that they're being disconnected
            rooms.forEach((users, roomId) => {
                io.to(roomId).emit('force-disconnect', 'Server clearing all rooms');
            });
            
            // Clear all rooms
            rooms.clear();
            console.log(`Cleared ${totalRooms} rooms and disconnected ${totalUsers} users`);
            break;

        case 'help':
            console.log('\nAvailable commands:');
            console.log('people - Show all rooms and users');
            console.log('clear  - Disconnect all users and clear all rooms');
            console.log('help   - Show this help message');
            break;

        default:
            console.log('Unknown command. Type "help" for available commands');
    }
});

// Update the server listening configuration
http.listen(port, '0.0.0.0', () => {
    const networks = os.networkInterfaces();
    console.log('\nAvailable Network Interfaces:');
    
    // First display all interfaces for debugging
    Object.keys(networks).forEach(name => {
        console.log(`\nInterface: ${name}`);
        networks[name].forEach(net => {
            console.log(`  ${net.family} - ${net.address}${net.internal ? ' (internal)' : ''}`);
        });
    });

    // Then collect and display all usable addresses
    const addresses = [];
    Object.keys(networks).forEach(name => {
        networks[name].forEach(net => {
            if (net.family === 'IPv4' && !net.internal) {
                addresses.push({ name, address: net.address });
            }
        });
    });

    if (addresses.length === 0) {
        console.log('\n⚠️  Warning: No external network interfaces found!');
        console.log('Server is only accessible on localhost (127.0.0.1)');
        console.log('Check your network connection and firewall settings');
    } else {
        console.log('\n🌐 Server URLs:');
        addresses.forEach(({ name, address }) => {
            console.log(`Network (${name}): http://${address}:${port}`);
        });
        console.log('\n📱 For mobile devices, use one of the Network URLs above');
        console.log('Make sure your phone is on the same WiFi network');
    }

    // Always show localhost for local development
    console.log('\n💻 Local development:');
    console.log(`Localhost: http://localhost:${port}`);
    console.log(`Local IP: http://127.0.0.1:${port}`);
});
