// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC721ReceiverChain {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @notice Stand-in for the ERC-8004 identity registry, for the local test chain only.
/// The chain suite places its runtime code at the real registry address, so it keeps
/// no constructor state: token IDs start at 1 because unset storage reads as zero.
/// It covers what ethagent calls: register, tokenURI, setAgentURI, and the ERC-721
/// transfers a Vault deposit and unwrap make. It is not enumerable, like the real one,
/// so owner lookups go through Transfer logs.
contract ChainIdentityRegistry {
    uint256 private _lastId;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => string) private _uris;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operators;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Registered(uint256 indexed agentId, address indexed owner, string agentURI);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    error NotAuthorized();
    error NonexistentToken();
    error UnsafeRecipient();

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = ++_lastId;
        _owners[agentId] = msg.sender;
        _balances[msg.sender] += 1;
        _uris[agentId] = agentURI;
        emit Transfer(address(0), msg.sender, agentId);
        emit Registered(agentId, msg.sender, agentURI);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (!_isApprovedOrOwner(msg.sender, agentId)) revert NotAuthorized();
        _uris[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return _uris[tokenId];
    }

    function getMetadata(uint256, string calldata) external pure returns (bytes memory) {
        return "";
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        if (owner == address(0)) revert NonexistentToken();
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operators[owner][msg.sender]) revert NotAuthorized();
        _approved[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        return _approved[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operators[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (!_isApprovedOrOwner(msg.sender, tokenId) || ownerOf(tokenId) != from) revert NotAuthorized();
        delete _approved[tokenId];
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length > 0) {
            bytes4 answer = IERC721ReceiverChain(to).onERC721Received(msg.sender, from, tokenId, data);
            if (answer != IERC721ReceiverChain.onERC721Received.selector) revert UnsafeRecipient();
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f || interfaceId == 0x01ffc9a7;
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) private view returns (bool) {
        address owner = ownerOf(tokenId);
        return spender == owner || _approved[tokenId] == spender || _operators[owner][spender];
    }
}
