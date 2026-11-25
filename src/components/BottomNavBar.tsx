
import React from 'react';
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import { BOTTOM_NAV_HEIGHT } from '../layout';
import { tokens } from '../tokens';
import AppsIcon from '@mui/icons-material/Apps';
import RemoteControlIcon from '@mui/icons-material/SettingsRemote';

interface BottomNavBarProps {
    view: 'remote' | 'apps';
    setView: (view: 'remote' | 'apps') => void;
}

const BottomNavBar: React.FC<BottomNavBarProps> = ({ view, setView }) => {
    const handleChange = (_event: React.SyntheticEvent, newValue: 'remote' | 'apps') => {
        setView(newValue);
    };

    return (
        <Paper
            sx={{
                borderTop: '1px solid',
                borderColor: 'divider',
                backgroundColor: tokens.surfaceLowest,
                borderRadius: 0,
                paddingBottom: 'env(safe-area-inset-bottom)',
            }}
        >
            <BottomNavigation
                value={view}
                onChange={handleChange}
                showLabels
                sx={{
                    height: BOTTOM_NAV_HEIGHT,
                    backgroundColor: 'transparent',
                    '& .MuiBottomNavigationAction-root': {
                        minHeight: BOTTOM_NAV_HEIGHT,
                        py: 0.75,
                    },
                    '& .MuiBottomNavigationAction-label': {
                        fontSize: '0.78rem',
                        '&.Mui-selected': {
                            fontSize: '0.8rem',
                            fontWeight: 700,
                        },
                    },
                    '& .MuiSvgIcon-root': {
                        fontSize: 26,
                    },
                }}
            >
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

export default React.memo(BottomNavBar, (prev, next) => prev.view === next.view && prev.setView === next.setView);
