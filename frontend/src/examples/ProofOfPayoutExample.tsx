import React, { useState } from 'react';
import { ProofOfPayout } from '../components/ProofOfPayout';

/**
 * Example component demonstrating ProofOfPayout usage
 */
export const ProofOfPayoutExample: React.FC = () => {
  const [remittanceId, setRemittanceId] = useState<number>(1);
  const [showCamera, setShowCamera] = useState(false);

  const handleRelease = async (remittanceId: number, proofImage: string) => {
    console.log('Releasing funds for remittance:', remittanceId);
    console.log('Proof image length:', proofImage.length);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    alert(`Funds released for remittance ${remittanceId}!`);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>ProofOfPayout Component Examples</h1>
      
      <div style={{ marginBottom: '30px', padding: '20px', background: '#f5f5f5', borderRadius: '8px' }}>
        <h2>Configuration</h2>
        <div style={{ marginBottom: '15px' }}>
          <label htmlFor="remittanceId" style={{ display: 'block', marginBottom: '5px' }}>
            Remittance ID:
          </label>
          <input
            id="remittanceId"
            type="number"
            value={remittanceId}
            onChange={(e) => setRemittanceId(parseInt(e.target.value) || 1)}
            style={{ padding: '8px', width: '200px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={showCamera}
              onChange={(e) => setShowCamera(e.target.checked)}
            />
            Enable Camera Mode
          </label>
        </div>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h2>Example 1: Display Only Mode</h2>
        <p>Shows transaction details without camera capture functionality.</p>
        {!showCamera && <ProofOfPayout remittanceId={remittanceId} />}
        {showCamera && <p style={{ color: '#666' }}>Disable camera mode to see this example.</p>}
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h2>Example 2: Camera Capture Mode</h2>
        <p>Includes camera functionality for capturing proof of payout images.</p>
        {showCamera && <ProofOfPayout remittanceId={remittanceId} onRelease={handleRelease} />}
        {!showCamera && <p style={{ color: '#666' }}>Enable camera mode to see this example.</p>}
      </div>

      <div style={{ padding: '20px', background: '#e3f2fd', borderRadius: '8px' }}>
        <h3>Usage Notes</h3>
        <ul>
          <li>Make sure <code>VITE_CONTRACT_ID</code> and <code>VITE_HORIZON_URL</code> are set in your .env file</li>
          <li>The component will fetch real data from the Stellar Horizon API</li>
          <li>Camera mode requires browser permission to access the device camera</li>
          <li>Transaction details are formatted automatically (addresses truncated, amounts converted from stroops)</li>
          <li>Click "View on Stellar Expert" to see the full transaction details on the blockchain explorer</li>
        </ul>
      </div>
    </div>
  );
};

export default ProofOfPayoutExample;
