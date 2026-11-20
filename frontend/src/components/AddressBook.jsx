import { useState, useEffect } from 'react'
import './AddressBook.css'
import {
  loadRecipients as readRecipients,
  saveRecipients as writeRecipients,
  type SavedRecipient,
} from '../utils/recipientStorage'

export interface AddressBookProps {
  onSelectRecipient: (recipient: {
    name: string
    address: string
    country: string
    memo?: string
  }) => void
  walletAddress: string | null
}

interface RecipientFormData {
  name: string
  address: string
  country: string
  memo: string
}

const EMPTY_FORM: RecipientFormData = { name: '', address: '', country: '', memo: '' }

/**
 * Saved recipients, scoped to the connected wallet. Without a wallet nothing
 * is persisted. All storage access goes through utils/recipientStorage,
 * which guards against storage exceptions (e.g. private mode).
 */
export default function AddressBook({ onSelectRecipient, walletAddress }: AddressBookProps) {
  const [recipients, setRecipients] = useState<SavedRecipient[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<SavedRecipient['id'] | null>(null)
  const [formData, setFormData] = useState<RecipientFormData>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  // Reload whenever the wallet changes so one wallet never sees another's contacts.
  useEffect(() => {
    const { recipients: saved, ok } = readRecipients(walletAddress)
    setRecipients(saved)
    setError(ok ? null : 'Saved recipients are unavailable (browser storage is blocked).')
  }, [walletAddress])

  const saveRecipients = (newRecipients: SavedRecipient[]) => {
    // Keep the UI usable even if persisting fails.
    setRecipients(newRecipients)
    if (walletAddress && !writeRecipients(walletAddress, newRecipients)) {
      setError('Failed to save recipients. Changes will be lost when you leave this page.')
    }
  }

  const validateAddress = (addr: string) => {
    return addr.length === 56 && addr.startsWith('G')
  }

  const handleAddRecipient = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    if (!formData.name.trim()) {
      setError('Name is required')
      return
    }

    if (!validateAddress(formData.address)) {
      setError('Invalid Stellar address')
      return
    }

    if (!formData.country.trim()) {
      setError('Country is required')
      return
    }

    if (editingId) {
      const updated = recipients.map(r =>
        r.id === editingId ? { ...formData, id: editingId } : r
      )
      saveRecipients(updated)
      setEditingId(null)
    } else {
      const newRecipient = {
        id: Date.now(),
        name: formData.name,
        address: formData.address,
        country: formData.country,
        memo: formData.memo
      }
      saveRecipients([...recipients, newRecipient])
    }

    setFormData(EMPTY_FORM)
    setShowForm(false)
  }

  const handleDeleteRecipient = (id: SavedRecipient['id']) => {
    saveRecipients(recipients.filter(r => r.id !== id))
  }

  const handleEditRecipient = (recipient: SavedRecipient) => {
    setFormData({
      name: recipient.name,
      address: recipient.address,
      country: recipient.country,
      memo: recipient.memo || ''
    })
    setEditingId(recipient.id)
    setShowForm(true)
  }

  const handleSelectRecipient = (recipient: SavedRecipient) => {
    onSelectRecipient({
      name: recipient.name,
      address: recipient.address,
      country: recipient.country,
      memo: recipient.memo
    })
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData(EMPTY_FORM)
    setError(null)
  }

  return (
    <div className="address-book">
      <div className="address-book-header">
        <h3>Saved Recipients</h3>
        <button
          className="btn-primary btn-small"
          onClick={() => setShowForm(true)}
          data-testid="add-recipient-btn"
        >
          + Add Recipient
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {!walletAddress && (
        <p className="empty-state" data-testid="address-book-no-wallet">
          Connect your wallet to save recipients on this device.
        </p>
      )}

      {showForm && (
        <form className="address-book-form" onSubmit={handleAddRecipient}>
          <div className="form-group">
            <label htmlFor="name">Name *</label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., John Doe"
              data-testid="recipient-name-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="address">Stellar Address *</label>
            <input
              id="address"
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="G..."
              data-testid="recipient-address-input"
            />
            <small>56 characters starting with G</small>
          </div>

          <div className="form-group">
            <label htmlFor="country">Country *</label>
            <input
              id="country"
              type="text"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              placeholder="e.g., Nigeria"
              data-testid="recipient-country-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="memo">Memo (optional)</label>
            <input
              id="memo"
              type="text"
              value={formData.memo}
              onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
              placeholder="e.g., Monthly allowance"
              data-testid="recipient-memo-input"
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" data-testid="save-recipient-btn">
              {editingId ? 'Update' : 'Add'} Recipient
            </button>
          </div>
        </form>
      )}

      <div className="recipients-list">
        {recipients.length === 0 && !showForm && (
          <p className="empty-state">No saved recipients. Add one to get started!</p>
        )}

        {recipients.map((recipient) => (
          <div key={recipient.id} className="recipient-card" data-testid={`recipient-card-${recipient.id}`}>
            <div className="recipient-info">
              <div className="recipient-name">{recipient.name}</div>
              <div className="recipient-country">{recipient.country}</div>
              <div className="recipient-address">{recipient.address.slice(0, 8)}...{recipient.address.slice(-8)}</div>
              {recipient.memo && <div className="recipient-memo">Memo: {recipient.memo}</div>}
            </div>

            <div className="recipient-actions">
              <button
                className="btn-action select"
                onClick={() => handleSelectRecipient(recipient)}
                data-testid={`select-recipient-${recipient.id}`}
              >
                Select
              </button>
              <button
                className="btn-action edit"
                onClick={() => handleEditRecipient(recipient)}
                data-testid={`edit-recipient-${recipient.id}`}
              >
                Edit
              </button>
              <button
                className="btn-action delete"
                onClick={() => handleDeleteRecipient(recipient.id)}
                data-testid={`delete-recipient-${recipient.id}`}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
