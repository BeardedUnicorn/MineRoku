import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import Button from './Button';
import './RemoteControl.css';

interface RokuDevice {
    name: string;
    ip: string;
    port: number;
    url: string;
}

interface RemoteControlProps {
    device: RokuDevice;
}

const RemoteControl: React.FC<RemoteControlProps> = ({ device }) => {
    const sendCommand = async (command: string) => {
        try {
            const response = await invoke('send_roku_command', {
                ip: device.ip,
                port: device.port,
                command: command,
            });
            console.log(`Command sent: ${command}, Response: ${response}`);
        } catch (error) {
            console.error(`Error sending command ${command}:`, error);
        }
    };

    return (
        <div className="remote-control">
            <h2>Controlling: {device.name}</h2>
            <div className="navigation-pad">
                <Button className="nav-button up" onClick={() => sendCommand('up')}>▲</Button>
                <div className="nav-middle">
                    <Button className="nav-button left" onClick={() => sendCommand('left')}>◀</Button>
                    <Button className="nav-button select" onClick={() => sendCommand('select')}>OK</Button>
                    <Button className="nav-button right" onClick={() => sendCommand('right')}>▶</Button>
                </div>
                <Button className="nav-button down" onClick={() => sendCommand('down')}>▼</Button>
            </div>

            <div className="control-buttons">
                <Button onClick={() => sendCommand('home')}>Home</Button>
                <Button onClick={() => sendCommand('back')}>Back</Button>
                <Button onClick={() => sendCommand('info')}>Info</Button>
            </div>

            <div className="playback-controls">
                <Button onClick={() => sendCommand('rev')}>Rewind</Button>
                <Button onClick={() => sendCommand('play')}>Play/Pause</Button>
                <Button onClick={() => sendCommand('fwd')}>Fast Forward</Button>
            </div>

            <div className="volume-controls">
                {/* Roku ECP does not directly support volume control via keypresses. */}
                {/* These buttons would typically require a different API or IR blaster. */}
                <Button disabled>Vol +</Button>
                <Button disabled>Mute</Button>
                <Button disabled>Vol -</Button>
            </div>
        </div>
    );
};

export default RemoteControl;