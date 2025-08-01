
import React from 'react';
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import { Apps as AppsIcon, SettingsRemote as RemoteControlIcon } from '@mui/icons-material';

interface BottomNavBarProps {
    view: 'remote' | 'apps';
    setView: (view: 'remote' | 'apps') => void;
}

const BottomNavBar: React.FC<BottomNavBarProps> = ({ view, setView }) => {
    const handleChange = (_event: React.SyntheticEvent, newValue: 'remote' | 'apps') => {
        setView(newValue);
    };

    return (
        <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000, paddingBottom: 'env(safe-area-inset-bottom)' }} elevation={3}>
            <BottomNavigation value={view} onChange={handleChange} showLabels>
                <BottomNavigationAction
                    label="Remote"
                    value="remote"
                    icon={<RemoteControlIcon />}
                />
                <BottomNavigationAction 
                    label="Apps"
                    value="apps"
                    icon={<AppsIcon />} 
                />
            </BottomNavigation>
        </Paper>
    );
};

export default BottomNavBar;
