// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

contract Counter {
    mapping(address => uint256) public counter;
    event IncrementCounter(uint256 newCounterValue, address msgSender);

    function increment() external {
        counter[msg.sender]++;
        emit IncrementCounter(counter[msg.sender], msg.sender);
    }
}
