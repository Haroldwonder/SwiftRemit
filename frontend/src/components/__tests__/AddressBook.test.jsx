import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import AddressBook from '../AddressBook'

describe('AddressBook Component', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('should render address book with add button', () => {
    render(<AddressBook onSelectRecipient={vi.fn()} />)
    expect(screen.getByText('Saved Recipients')).toBeInTheDocument()
    expect(screen.getByTestId('add-recipient-btn')).toBeInTheDocument()
  })

  it('should show empty state when no recipients', () => {
    render(<AddressBook onSelectRecipient={vi.fn()} />)
    expect(screen.getByText('No saved recipients. Add one to get started!')).toBeInTheDocument()
  })

  describe('Adding recipients', () => {
    it('should open form when add button is clicked', () => {
      render(<AddressBook onSelectRecipient={vi.fn()} />)
      fireEvent.click(screen.getByTestId('add-recipient-btn'))
      expect(screen.getByTestId('recipient-name-input')).toBeInTheDocument()
      expect(screen.getByTestId('recipient-address-input')).toBeInTheDocument()
      expect(screen.getByTestId('recipient-country-input')).toBeInTheDocument()
    })

    it('should show validation error for empty name', () => {
      render(<AddressBook onSelectRecipient={vi.fn()} />)
      
      fireEvent.click(screen.getByTestId('add-recipient-btn'))
      fireEvent.change(screen.getByTestId('recipient-address-input'), { 
        target: { value: 'GBDHJKD7NDHJKSD7HJKSJHD7JKSHD7JKSHDKJH7' } 
      })
      fireEvent.change(screen.getByTestId('recipient-country-input'), { target: { value: 'Nigeria' } })
      
      fireEvent.click(screen.getByTestId('save-recipient-btn'))
      
      expect(screen.getByText('Name is required')).toBeInTheDocument()
    })

    it('should show validation error for invalid address', () => {
      render(<AddressBook onSelectRecipient={vi.fn()} />)
      
      fireEvent.click(screen.getByTestId('add-recipient-btn'))
      fireEvent.change(screen.getByTestId('recipient-name-input'), { target: { value: 'John' } })
      fireEvent.change(screen.getByTestId('recipient-address-input'), { target: { value: 'INVALID' } })
      fireEvent.change(screen.getByTestId('recipient-country-input'), { target: { value: 'Nigeria' } })
      
      fireEvent.click(screen.getByTestId('save-recipient-btn'))
      
      expect(screen.getByText('Invalid Stellar address')).toBeInTheDocument()
    })
  })

  describe('Recipient display', () => {
    it('should display saved recipient from localStorage', () => {
      const savedRecipients = [
        {
          id: 1,
          name: 'John Doe',
          address: 'GBDHJKD7NDHJKSD7HJKSJHD7JKSHD7JKSHDKJH7',
          country: 'Nigeria',
          memo: ''
        }
      ]
      localStorage.setItem('swiftremit_recipients', JSON.stringify(savedRecipients))
      
      render(<AddressBook onSelectRecipient={vi.fn()} />)
      
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('Nigeria')).toBeInTheDocument()
    })
  })

  describe('Editing recipients', () => {
    beforeEach(() => {
      const savedRecipients = [
        {
          id: 1,
          name: 'John Doe',
          address: 'GBDHJKD7NDHJKSD7HJKSJHD7JKSHD7JKSHDKJH7',
          country: 'Nigeria',
          memo: 'Monthly support'
        }
      ]
      localStorage.setItem('swiftremit_recipients', JSON.stringify(savedRecipients))
    })

    it('should load recipients from localStorage', () => {
      render(<AddressBook onSelectRecipient={vi.fn()} />)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('should delete recipient', () => {
      render(<AddressBook onSelectRecipient={vi.fn()} />)
      
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      
      fireEvent.click(screen.getByTestId('delete-recipient-1'))
      
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
      expect(screen.getByText('No saved recipients. Add one to get started!')).toBeInTheDocument()
    })
  })

  describe('Selecting recipient', () => {
    beforeEach(() => {
      const savedRecipients = [
        {
          id: 1,
          name: 'John Doe',
          address: 'GBDHJKD7NDHJKSD7HJKSJHD7JKSHD7JKSHDKJH7',
          country: 'Nigeria',
          memo: 'Monthly support'
        }
      ]
      localStorage.setItem('swiftremit_recipients', JSON.stringify(savedRecipients))
    })

    it('should call onSelectRecipient with recipient data', () => {
      const onSelect = vi.fn()
      render(<AddressBook onSelectRecipient={onSelect} />)
      
      fireEvent.click(screen.getByTestId('select-recipient-1'))
      
      expect(onSelect).toHaveBeenCalledWith({
        name: 'John Doe',
        address: 'GBDHJKD7NDHJKSD7HJKSJHD7JKSHD7JKSHDKJH7',
        country: 'Nigeria',
        memo: 'Monthly support'
      })
    })
  })

  describe('Form cancellation', () => {
    it('should cancel form and clear input', () => {
      render(<AddressBook onSelectRecipient={vi.fn()} />)
      
      fireEvent.click(screen.getByTestId('add-recipient-btn'))
      fireEvent.change(screen.getByTestId('recipient-name-input'), { target: { value: 'Test' } })
      fireEvent.click(screen.getByText('Cancel'))
      
      expect(screen.queryByTestId('recipient-name-input')).not.toBeInTheDocument()
      expect(screen.getByText('No saved recipients. Add one to get started!')).toBeInTheDocument()
    })
  })

  describe('Multiple recipients', () => {
    it('should display multiple recipients from localStorage', () => {
      const savedRecipients = [
        {
          id: 1,
          name: 'Person 1',
          address: 'GBDHJKD7NDHJKSD7HJKSJHD7JKSHD7JKSHDKJH7',
          country: 'Nigeria',
          memo: ''
        },
        {
          id: 2,
          name: 'Person 2',
          address: 'GBDHJKD7NDHJKSD7HJKSJHD7JKSHD7JKSHDKJH7',
          country: 'Ghana',
          memo: ''
        }
      ]
      localStorage.setItem('swiftremit_recipients', JSON.stringify(savedRecipients))
      
      render(<AddressBook onSelectRecipient={vi.fn()} />)
      
      expect(screen.getByText('Person 1')).toBeInTheDocument()
      expect(screen.getByText('Person 2')).toBeInTheDocument()
    })
  })
})
