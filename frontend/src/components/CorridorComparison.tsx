import React, { useEffect, useState, useMemo } from 'react';
import './CorridorComparison.css';

interface Corridor {
  id: string;
  sourceCountry: string;
  destinationCountry: string;
  currency: string;
  feePercentage: number;
  fxRate: number;
  estimatedDeliveryTime: string;
}

interface CorridorComparisonProps {
  onSelect?: (corridor: Corridor) => void;
  sourceCountry?: string;
  destinationCountry?: string;
}

export function CorridorComparison({
  onSelect,
  sourceCountry,
  destinationCountry,
}: CorridorComparisonProps): React.ReactElement {
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState(sourceCountry || '');
  const [filterDest, setFilterDest] = useState(destinationCountry || '');

  useEffect(() => {
    const fetchCorridors = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/corridors');
        if (!response.ok) throw new Error('Failed to fetch corridors');
        const data = await response.json();
        setCorridors(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchCorridors();
  }, []);

  const filtered = useMemo(() => {
    return corridors.filter(c => {
      if (filterSource && c.sourceCountry !== filterSource) return false;
      if (filterDest && c.destinationCountry !== filterDest) return false;
      return true;
    }).sort((a, b) => a.feePercentage - b.feePercentage);
  }, [corridors, filterSource, filterDest]);

  const uniqueSources = useMemo(() => [...new Set(corridors.map(c => c.sourceCountry))], [corridors]);
  const uniqueDests = useMemo(() => [...new Set(corridors.map(c => c.destinationCountry))], [corridors]);

  if (loading) {
    return <div className="corridor-loading">Loading corridors...</div>;
  }

  if (error) {
    return <div className="corridor-error">Error: {error}</div>;
  }

  return (
    <div className="corridor-comparison">
      <h2>Compare Corridors</h2>

      <div className="corridor-filters">
        <div className="filter-group">
          <label htmlFor="source-filter">Source Country</label>
          <select
            id="source-filter"
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
          >
            <option value="">All Source Countries</option>
            {uniqueSources.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="dest-filter">Destination Country</label>
          <select
            id="dest-filter"
            value={filterDest}
            onChange={e => setFilterDest(e.target.value)}
          >
            <option value="">All Destination Countries</option>
            {uniqueDests.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="corridor-empty">No corridors match your filters</div>
      ) : (
        <div className="corridor-table-container">
          <table className="corridor-table">
            <thead>
              <tr>
                <th>Route</th>
                <th>Currency</th>
                <th>Fee %</th>
                <th>FX Rate</th>
                <th>Delivery Time</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(corridor => (
                <tr key={corridor.id}>
                  <td className="route-cell">
                    <span className="route-badge">{corridor.sourceCountry}</span>
                    <span className="route-arrow">→</span>
                    <span className="route-badge">{corridor.destinationCountry}</span>
                  </td>
                  <td>{corridor.currency}</td>
                  <td className="fee-cell">
                    <span className="fee-badge">{corridor.feePercentage.toFixed(2)}%</span>
                  </td>
                  <td>{corridor.fxRate.toFixed(4)}</td>
                  <td>{corridor.estimatedDeliveryTime}</td>
                  <td>
                    <button
                      className="corridor-select-btn"
                      onClick={() => onSelect?.(corridor)}
                      aria-label={`Select ${corridor.sourceCountry} to ${corridor.destinationCountry}`}
                    >
                      Select
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default CorridorComparison;
