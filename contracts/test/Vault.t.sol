// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vault, IERC721Receiver} from "../src/Vault.sol";

/// @notice Minimal ERC-721-with-setAgentURI mock that mimics the relevant
/// surface of the ERC-8004 registry: ownerOf, safeTransferFrom (to a
/// recipient implementing onERC721Received), and an owner-gated
/// setAgentURI that records the latest URI for assertion.
contract MockErc8004 {
    mapping(uint256 => address) private _ownerOf;
    mapping(uint256 => string) public agentURI;

    function mint(address to, uint256 tokenId) external {
        _ownerOf[tokenId] = to;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return _ownerOf[tokenId];
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(msg.sender == _ownerOf[agentId], "ERC8004: only owner");
        agentURI[agentId] = newURI;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        require(_ownerOf[tokenId] == from, "ERC721: from is not owner");
        require(msg.sender == from, "ERC721: msg.sender is not from");
        _ownerOf[tokenId] = to;
        // Always invoke the receiver hook to mirror real ERC-721 safeTransferFrom semantics.
        if (_isContract(to)) {
            bytes4 ret = IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, "");
            require(ret == IERC721Receiver.onERC721Received.selector, "ERC721: receiver rejected");
        }
    }

    function _isContract(address account) private view returns (bool) {
        return account.code.length > 0;
    }
}

contract VaultTest is Test {
    Vault internal vault;
    MockErc8004 internal registry;

    address internal owner = address(0xA11CE);
    address internal operator = address(0xB0B);
    address internal stranger = address(0xCAFE);
    address internal recipient = address(0xD00D);
    uint256 internal constant AGENT_ID = 42;

    event AgentDeposited(address indexed registry, uint256 indexed agentId, address indexed owner);
    event AgentUnwrapped(address indexed registry, uint256 indexed agentId, address indexed recipient);
    event MetadataOperatorChanged(
        address indexed registry,
        uint256 indexed agentId,
        address indexed operator,
        bool approved
    );
    event AgentURIRotated(
        address indexed registry,
        uint256 indexed agentId,
        string newURI,
        address indexed signer
    );

    function setUp() public {
        registry = new MockErc8004();
        vault = new Vault(address(registry), AGENT_ID);
        registry.mint(owner, AGENT_ID);
    }

    function _deposit() internal {
        vm.prank(owner);
        registry.safeTransferFrom(owner, address(vault), AGENT_ID);
    }

    function test_DepositRecordsOwner() public {
        vm.prank(owner);
        vm.expectEmit(true, true, true, true, address(vault));
        emit AgentDeposited(address(registry), AGENT_ID, owner);
        registry.safeTransferFrom(owner, address(vault), AGENT_ID);

        assertEq(vault.agentOwner(address(registry), AGENT_ID), owner);
        assertEq(registry.ownerOf(AGENT_ID), address(vault));
    }

    function test_RevertOnDoubleDeposit() public {
        _deposit();
        // A direct second onERC721Received call (with msg.sender spoofed to
        // the registry) must revert with AlreadyDeposited.
        vm.prank(address(registry));
        vm.expectRevert(Vault.AlreadyDeposited.selector);
        vault.onERC721Received(address(0), stranger, AGENT_ID, "");
    }

    function test_OwnerCanAuthorizeAndRevokeOperator() public {
        _deposit();

        vm.prank(owner);
        vm.expectEmit(true, true, true, true, address(vault));
        emit MetadataOperatorChanged(address(registry), AGENT_ID, operator, true);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, true);
        assertTrue(vault.metadataOperators(address(registry), AGENT_ID, operator));

        vm.prank(owner);
        vm.expectEmit(true, true, true, true, address(vault));
        emit MetadataOperatorChanged(address(registry), AGENT_ID, operator, false);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, false);
        assertFalse(vault.metadataOperators(address(registry), AGENT_ID, operator));
    }

    function test_NonOwnerCannotAuthorizeOperator() public {
        _deposit();

        vm.prank(stranger);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, true);

        vm.prank(operator);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.setMetadataOperator(address(registry), AGENT_ID, stranger, true);
    }

    function test_OwnerCanRotateUri() public {
        _deposit();

        vm.prank(owner);
        vm.expectEmit(true, true, true, true, address(vault));
        emit AgentURIRotated(address(registry), AGENT_ID, "ipfs://new", owner);
        vault.rotateAgentURI(address(registry), AGENT_ID, "ipfs://new");

        assertEq(registry.agentURI(AGENT_ID), "ipfs://new");
    }

    function test_AuthorizedOperatorCanRotateUri() public {
        _deposit();

        vm.prank(owner);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, true);

        vm.prank(operator);
        vm.expectEmit(true, true, true, true, address(vault));
        emit AgentURIRotated(address(registry), AGENT_ID, "ipfs://from-operator", operator);
        vault.rotateAgentURI(address(registry), AGENT_ID, "ipfs://from-operator");

        assertEq(registry.agentURI(AGENT_ID), "ipfs://from-operator");
    }

    function test_StrangerCannotRotateUri() public {
        _deposit();

        vm.prank(stranger);
        vm.expectRevert(Vault.NotAuthorized.selector);
        vault.rotateAgentURI(address(registry), AGENT_ID, "ipfs://forbidden");
    }

    function test_RevokedOperatorCannotRotateUri() public {
        _deposit();

        vm.startPrank(owner);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, true);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, false);
        vm.stopPrank();

        vm.prank(operator);
        vm.expectRevert(Vault.NotAuthorized.selector);
        vault.rotateAgentURI(address(registry), AGENT_ID, "ipfs://forbidden");
    }

    function test_OperatorCannotUnwrapToken() public {
        _deposit();

        vm.prank(owner);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, true);

        vm.prank(operator);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.unwrap(address(registry), AGENT_ID, recipient);
    }

    function test_OperatorCannotAuthorizeOtherOperators() public {
        _deposit();

        vm.prank(owner);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, true);

        // Even though `operator` can rotate URI, it cannot grant the same
        // privilege to another address.
        vm.prank(operator);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.setMetadataOperator(address(registry), AGENT_ID, stranger, true);
    }

    function test_OwnerCanUnwrapToken() public {
        _deposit();

        vm.prank(owner);
        vm.expectEmit(true, true, true, true, address(vault));
        emit AgentUnwrapped(address(registry), AGENT_ID, recipient);
        vault.unwrap(address(registry), AGENT_ID, recipient);

        assertEq(registry.ownerOf(AGENT_ID), recipient);
        assertEq(vault.agentOwner(address(registry), AGENT_ID), address(0));
    }

    function test_NonOwnerCannotUnwrapToken() public {
        _deposit();

        vm.prank(stranger);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.unwrap(address(registry), AGENT_ID, stranger);
    }

    function test_RedepositAfterUnwrapClearsOldOwnerSlotAndReauthorization() public {
        _deposit();

        // Original owner authorizes an operator, then takes the token back.
        vm.startPrank(owner);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, true);
        vault.unwrap(address(registry), AGENT_ID, recipient);
        vm.stopPrank();

        assertEq(vault.agentOwner(address(registry), AGENT_ID), address(0));

        // recipient redeposits the token.
        vm.prank(recipient);
        registry.safeTransferFrom(recipient, address(vault), AGENT_ID);
        assertEq(vault.agentOwner(address(registry), AGENT_ID), recipient);

        assertFalse(vault.metadataOperators(address(registry), AGENT_ID, operator));

        vm.prank(operator);
        vm.expectRevert(Vault.NotAuthorized.selector);
        vault.rotateAgentURI(address(registry), AGENT_ID, "ipfs://under-new-owner");

        vm.prank(recipient);
        vault.setMetadataOperator(address(registry), AGENT_ID, operator, true);

        vm.prank(operator);
        vault.rotateAgentURI(address(registry), AGENT_ID, "ipfs://under-new-owner");
        assertEq(registry.agentURI(AGENT_ID), "ipfs://under-new-owner");
    }

    function test_RevertWhenDifferentAgentDepositedIntoEmptyVault() public {
        uint256 otherId = 999;
        registry.mint(stranger, otherId);

        vm.prank(stranger);
        vm.expectRevert(Vault.UnexpectedToken.selector);
        registry.safeTransferFrom(stranger, address(vault), otherId);

        assertEq(registry.ownerOf(AGENT_ID), owner);
        assertEq(registry.ownerOf(otherId), stranger);
        assertEq(vault.agentOwner(address(registry), AGENT_ID), address(0));
    }

    function test_RevertWhenDifferentAgentDepositedWhileOccupied() public {
        uint256 otherId = 999;
        registry.mint(stranger, otherId);

        _deposit();
        vm.prank(stranger);
        vm.expectRevert(Vault.UnexpectedToken.selector);
        registry.safeTransferFrom(stranger, address(vault), otherId);

        assertEq(registry.ownerOf(AGENT_ID), address(vault));
        assertEq(registry.ownerOf(otherId), stranger);
        assertEq(vault.agentOwner(address(registry), otherId), address(0));
    }

    function test_DifferentAgentCannotDepositAfterUnwrap() public {
        uint256 otherId = 999;
        registry.mint(stranger, otherId);

        _deposit();
        vm.prank(owner);
        vault.unwrap(address(registry), AGENT_ID, owner);
        vm.prank(stranger);
        vm.expectRevert(Vault.UnexpectedToken.selector);
        registry.safeTransferFrom(stranger, address(vault), otherId);

        assertEq(vault.agentOwner(address(registry), AGENT_ID), address(0));
        assertEq(vault.agentOwner(address(registry), otherId), address(0));
        assertEq(registry.ownerOf(AGENT_ID), owner);
        assertEq(registry.ownerOf(otherId), stranger);
    }
}
