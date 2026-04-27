import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import './App.css'
import WalletConnect from './components/WalletConnect'
import CreateRemittance from './components/CreateRemittance'
import RemittanceList from './components/RemittanceList'
import AgentPanel from './components/AgentPanel'
import ContractHealth from './components/ContractHealth'
import { LanguageSelector } from './components/LanguageSelector'

function App() {
  const { t } = useTranslation()
  const [walletAddress, setWalletAddress] = useState(null)
  const [contractId, setContractId] = useState(import.meta.env.VITE_CONTRACT_ID || '')

  return (
    <div className="App" dir="auto">
      <header className="app-header">
        <div className="app-header-top">
          <h1>💸 {t('app.title')}</h1>
          <LanguageSelector />
        </div>
        <p>{t('app.subtitle')}</p>
      </header>

      <main className="app-main">
        <WalletConnect 
          walletAddress={walletAddress} 
          setWalletAddress={setWalletAddress} 
        />

        {walletAddress && (
          <>
            <div className="contract-config">
              <label>
                Contract ID:
                <input
                  type="text"
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                  placeholder="Enter contract ID"
                />
              </label>
            </div>

            <div className="panels">
              <CreateRemittance 
                walletAddress={walletAddress}
                contractId={contractId}
              />
              
              <AgentPanel 
                walletAddress={walletAddress}
                contractId={contractId}
              />
            </div>

            <RemittanceList 
              walletAddress={walletAddress}
              contractId={contractId}
            />

            <ContractHealth
              walletAddress={walletAddress}
              contractId={contractId}
            />
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>{t('app.footer')}</p>
      </footer>
    </div>
  )
}

export default App
