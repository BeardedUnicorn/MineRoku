// src/App.tsx
import React, { useState } from 'react';
import DeviceTabs from './components/DeviceTabs';
import RemoteControl from './components/RemoteControl';
import './App.css';

interface RokuDevice {
    name: string;
    ip: string;
    port: number;
    url: string;
}

const App: React.FC = () => {
    const [selectedDevice, setSelectedDevice] = useState<RokuDevice | null>(null);

    const handleDeviceSelect = (device: RokuDevice) => {
        setSelectedDevice(device);
    };

    return (
        <div className="app-container">
            <h1>Roku Controller</h1>
            <DeviceTabs onDeviceSelect={handleDeviceSelect} />
            {selectedDevice ? (
                <RemoteControl device={selectedDevice} />
            ) : (
                <p>Select a Roku device to control.</p>
            )}
        </div>
    );
};


export default App
