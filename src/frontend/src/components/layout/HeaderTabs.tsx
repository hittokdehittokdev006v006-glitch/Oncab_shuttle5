import React from 'react';
import { View } from '../../types';

interface HeaderTabsProps {
  currentView: View;
  onSelectView: (view: View) => void;
}

const TABS: { id: View; label: string }[] = [
  { id: 'scheduled-trips', label: 'Scheduled Trips' },
  { id: 'trips', label: 'Trips' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'route-creation', label: 'Route Creation' },
  { id: 'passes-management', label: 'Passes Management' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'cancelled-tickets-refund', label: 'Cancelled Tickets Refund' },
  { id: 'failed-paid-refund', label: 'Failed & Paid Refund' },
];

export const HeaderTabs: React.FC<HeaderTabsProps> = ({ currentView, onSelectView }) => {
  return (
    <nav className="header-tabs" aria-label="Operator dashboard sections">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={currentView === tab.id ? 'active' : ''}
          onClick={() => onSelectView(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
};
