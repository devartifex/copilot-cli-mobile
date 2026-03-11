@description('Name prefix for the storage account')
param name string

@description('Location for the resource')
param location string

param tags object = {}

@description('Name of the file share for persistent data')
param shareName string = 'copilot-data'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'FileStorage'
  sku: {
    name: 'Premium_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: false // NFS 4.1 uses TCP port 2049
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // NFS uses network-level auth, no key needed
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: shareName
  properties: {
    enabledProtocols: 'NFS'
    rootSquash: 'NoRootSquash'
    shareQuota: 100 // Minimum 100 GiB for Premium NFS shares
  }
}

output storageAccountName string = storageAccount.name
output shareName string = fileShare.name
