import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as FreighterAPI from '@stellar/freighter-api'
import WalletConnect from '../WalletConnect'

vi.mock('@stellar/freighter-api')

describe('WalletConnect Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Freighter not installed', () => {
    it('should show install prompt when Freighter is not installed', async () => {
      vi.mocked(FreighterAPI.isConnected).mockResolvedValue(false)
      
      render(<WalletConnect walletAddress={null} setWalletAddress={vi.fn()} />)
      
      fireEvent.click(screen.getByTestId('connect-wallet-btn'))
      
      await waitFor(() => {
        expect(screen.getByText(/Freighter wallet not found/i)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /Install Freighter Wallet/i })).toHaveAttribute(
          'href',
          'https://www.freighter.app/'
        )
      })
    })
  })

  describe('Network mismatch', () => {
    it('should show network mismatch error with guidance', async () => {
      vi.mocked(FreighterAPI.isConnected).mockResolvedValue(true)
      vi.mocked(FreighterAPI.requestAccess).mockRejectedValue(
        new Error('Network mismatch: wallet on mainnet but testnet expected')
      )
      
      render(<WalletConnect walletAddress={null} setWalletAddress={vi.fn()} />)
      
      fireEvent.click(screen.getByTestId('connect-wallet-btn'))
      
      await waitFor(() => {
        expect(screen.getByText(/network/i)).toBeInTheDocument()
        expect(screen.getByText(/switch your Freighter wallet/i)).toBeInTheDocument()
      })
    })
  })

  describe('User rejection', () => {
    it('should show retry option when user rejects connection', async () => {
      vi.mocked(FreighterAPI.isConnected).mockResolvedValue(true)
      vi.mocked(FreighterAPI.requestAccess).mockRejectedValue(
        new Error('User denied access')
      )
      
      render(<WalletConnect walletAddress={null} setWalletAddress={vi.fn()} />)
      
      fireEvent.click(screen.getByTestId('connect-wallet-btn'))
      
      await waitFor(() => {
        expect(screen.getByText(/Connection rejected/i)).toBeInTheDocument()
        expect(screen.getByText(/Retry Connection/i)).toBeInTheDocument()
      })
    })
  })

  describe('Generic error', () => {
    it('should show retry button for generic errors', async () => {
      vi.mocked(FreighterAPI.isConnected).mockResolvedValue(true)
      vi.mocked(FreighterAPI.requestAccess).mockRejectedValue(new Error('Connection failed'))
      
      render(<WalletConnect walletAddress={null} setWalletAddress={vi.fn()} />)
      
      fireEvent.click(screen.getByTestId('connect-wallet-btn'))
      
      await waitFor(() => {
        expect(screen.getByText(/Connection failed/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
      })
    })
  })

  describe('Success flow', () => {
    it('should display connected wallet address truncated', () => {
      render(
        <WalletConnect 
          walletAddress="GBDHJKD7NDHJKSD7HJKSJHD7JKSHD7JKSHDKJH7" 
          setWalletAddress={vi.fn()} 
        />
      )
      
      const connectedText = screen.getByText(/Connected:/)
      expect(connectedText).toBeInTheDocument()
      expect(connectedText.textContent).toContain('GBDHJKD7')
      expect(connectedText.textContent).toContain('KSHDKJH7')
      expect(screen.getByRole('button', { name: /Disconnect/i })).toBeInTheDocument()
    })

    it('should disconnect wallet on button click', () => {
      const setWalletAddress = vi.fn()
      render(
        <WalletConnect 
          walletAddress="GBDHJKD7NDHJKSD7HJKSJHD7JKSHD7JKSHDKJH7" 
          setWalletAddress={setWalletAddress} 
        />
      )
      
      fireEvent.click(screen.getByRole('button', { name: /Disconnect/i }))
      
      expect(setWalletAddress).toHaveBeenCalledWith(null)
    })
  })

  describe('Loading state', () => {
    it('should show loading text while connecting', async () => {
      vi.mocked(FreighterAPI.isConnected).mockImplementation(() => new Promise(() => {}))
      
      render(<WalletConnect walletAddress={null} setWalletAddress={vi.fn()} />)
      
      fireEvent.click(screen.getByTestId('connect-wallet-btn'))
      
      expect(screen.getByText(/Connecting.../)).toBeInTheDocument()
      expect(screen.getByTestId('connect-wallet-btn')).toBeDisabled()
    })
  })
})
